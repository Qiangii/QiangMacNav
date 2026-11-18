package main

import (
	"bytes"
	"io"
	"log"
	"navigation/server/internal/updates"
	"net/http"
	"os"
	"time"
)

func main() {
	token := os.Getenv("UPDATER_TOKEN")
	if len(token) < 32 {
		log.Fatal("UPDATER_TOKEN must contain at least 32 characters")
	}
	if len(os.Args) == 2 && (os.Args[1] == "status" || os.Args[1] == "recover") {
		method, path := "GET", "/status"
		if os.Args[1] == "recover" {
			method, path = "POST", "/recover"
		}
		req, _ := http.NewRequest(method, "http://127.0.0.1:8090"+path, bytes.NewBufferString("{}"))
		req.Header.Set("Authorization", "Bearer "+token)
		res, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
		if err != nil {
			log.Fatal(err)
		}
		defer res.Body.Close()
		io.Copy(os.Stdout, res.Body)
		if res.StatusCode >= 300 {
			os.Exit(1)
		}
		return
	}
	self, err := os.Hostname()
	if err != nil {
		log.Fatal(err)
	}
	target := os.Getenv("UPDATE_CONTAINER")
	if target == "" {
		target = "harbor-navigation"
	}
	runner := &updates.Runner{Engine: updates.NewEngine("/var/run/docker.sock"), Source: updates.SourceFromEnv(), Target: target, Self: self, DataDir: "/data", StateDir: "/state"}
	if err = runner.Source.Validate(); err != nil {
		log.Fatal(err)
	}
	if err = runner.Load(); err != nil {
		log.Fatal(err)
	}
	server := &http.Server{Addr: ":8090", Handler: updates.Handler(runner, token), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 30 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16 << 10}
	log.Printf("update service ready for %s", target)
	log.Fatal(server.ListenAndServe())
}
