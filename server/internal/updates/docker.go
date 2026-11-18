package updates

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type Engine struct{ Client *http.Client }

const dockerAPI = "/v1.41"

func NewEngine(socket string) *Engine {
	return &Engine{Client: &http.Client{Transport: &http.Transport{DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{Timeout: 5 * time.Second}).DialContext(ctx, "unix", socket)
	}}}}
}

func (d *Engine) call(ctx context.Context, method, path string, body any, result any) error {
	var input io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return err
		}
		input = bytes.NewReader(data)
	}
	req, err := http.NewRequestWithContext(ctx, method, "http://docker"+dockerAPI+path, input)
	if err != nil {
		return err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	res, err := d.Client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		if res.StatusCode == 404 {
			return ErrNotFound
		}
		data, _ := io.ReadAll(io.LimitReader(res.Body, 2048))
		return fmt.Errorf("Docker %s: %d %s", method, res.StatusCode, data)
	}
	if result != nil {
		return json.NewDecoder(io.LimitReader(res.Body, 4<<20)).Decode(result)
	}
	_, err = io.Copy(io.Discard, res.Body)
	return err
}

var ErrNotFound = errors.New("container not found")

type Container struct {
	ID         string `json:"Id"`
	Name       string
	Image      string
	Config     map[string]any
	HostConfig map[string]any
	Mounts     []struct {
		Type, Source, Destination string
		RW                        bool
	}
	NetworkSettings struct{ Networks map[string]map[string]any }
	State           struct {
		Running bool
		Status  string
		Health  struct{ Status string }
	}
}

func (c *Container) Label(key string) string {
	labels, _ := c.Config["Labels"].(map[string]any)
	value, _ := labels[key].(string)
	return value
}

func (d *Engine) Inspect(ctx context.Context, id string) (*Container, error) {
	var c Container
	err := d.call(ctx, "GET", "/containers/"+url.PathEscape(id)+"/json", nil, &c)
	return &c, err
}

func (d *Engine) Pull(ctx context.Context, image string) (map[string]any, error) {
	req, err := http.NewRequestWithContext(ctx, "POST", "http://docker"+dockerAPI+"/images/create?fromImage="+url.QueryEscape(image), nil)
	if err != nil {
		return nil, err
	}
	res, err := d.Client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return nil, fmt.Errorf("镜像拉取失败（%d）", res.StatusCode)
	}
	decoder := json.NewDecoder(io.LimitReader(res.Body, 32<<20))
	for {
		var event struct {
			Error string `json:"error"`
		}
		err := decoder.Decode(&event)
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, err
		}
		if event.Error != "" {
			return nil, errors.New(event.Error)
		}
	}
	var data struct{ Config map[string]any }
	err = d.call(ctx, "GET", "/images/"+url.PathEscape(image)+"/json", nil, &data)
	return data.Config, err
}

func (d *Engine) Stop(ctx context.Context, id string) error {
	c, err := d.Inspect(ctx, id)
	if err != nil {
		return err
	}
	if !c.State.Running {
		return nil
	}
	return d.call(ctx, "POST", "/containers/"+id+"/stop?t=20", nil, nil)
}
func (d *Engine) Start(ctx context.Context, id string) error {
	return d.call(ctx, "POST", "/containers/"+id+"/start", nil, nil)
}
func (d *Engine) Rename(ctx context.Context, id, name string) error {
	return d.call(ctx, "POST", "/containers/"+id+"/rename?name="+url.QueryEscape(name), nil, nil)
}
func (d *Engine) Remove(ctx context.Context, id string) error {
	return d.call(ctx, "DELETE", "/containers/"+id+"?v=false", nil, nil)
}

func (d *Engine) Create(ctx context.Context, old *Container, name, image, job string, imageConfig map[string]any) (string, error) {
	config := make(map[string]any)
	for k, v := range old.Config {
		config[k] = v
	}
	config["Image"] = image
	if hostname, _ := config["Hostname"].(string); strings.HasPrefix(old.ID, hostname) {
		config["Hostname"] = ""
	}
	labels := make(map[string]any)
	if original, ok := old.Config["Labels"].(map[string]any); ok {
		for k, v := range original {
			labels[k] = v
		}
	}
	if next, ok := imageConfig["Labels"].(map[string]any); ok {
		for k, v := range next {
			if strings.HasPrefix(k, "org.opencontainers.image.") || k == "io.qiangmacnav.update.protocol" {
				labels[k] = v
			}
		}
	}
	labels["io.qiangmacnav.update.job"] = job
	config["Labels"] = labels
	config["Healthcheck"] = imageConfig["Healthcheck"]
	config["HostConfig"] = old.HostConfig
	endpoints := make(map[string]any)
	for network, settings := range old.NetworkSettings.Networks {
		endpoint := make(map[string]any)
		for _, k := range []string{"Aliases", "Links", "IPAMConfig", "DriverOpts"} {
			if value, exists := settings[k]; exists && value != nil {
				endpoint[k] = value
			}
		}
		endpoints[network] = endpoint
	}
	config["NetworkingConfig"] = map[string]any{"EndpointsConfig": endpoints}
	var created struct {
		ID string `json:"Id"`
	}
	err := d.call(ctx, "POST", "/containers/create?name="+url.QueryEscape(name), config, &created)
	return created.ID, err
}

func (d *Engine) Tag(ctx context.Context, image, channel string) error {
	separator := strings.LastIndex(channel, ":")
	if separator <= strings.LastIndex(channel, "/") {
		return errors.New("镜像更新通道缺少标签")
	}
	return d.call(ctx, "POST", "/images/"+url.PathEscape(image)+"/tag?repo="+url.QueryEscape(channel[:separator])+"&tag="+url.QueryEscape(channel[separator+1:]), nil, nil)
}
