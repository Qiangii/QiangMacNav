package main

import (
	"encoding/json"
	"errors"
)

const defaultDockTools = `["navigation","search","settings"]`

func validateDockTools(tools []string) error {
	seen := make(map[string]bool)
	for _, tool := range tools {
		switch tool {
		case "navigation", "search", "add", "settings":
		default:
			return errors.New("无效的 Dock 固定图标")
		}
		if seen[tool] {
			return errors.New("Dock 固定图标不能重复")
		}
		seen[tool] = true
	}
	return nil
}

func (a *app) dockTools(owner string) ([]string, error) {
	var raw string
	if err := a.db.QueryRow("SELECT dock_tools FROM preferences WHERE user_id=?", owner).Scan(&raw); err != nil {
		return nil, err
	}
	var tools []string
	if err := json.Unmarshal([]byte(raw), &tools); err != nil {
		return nil, err
	}
	if tools == nil {
		return nil, errors.New("无效的 Dock 固定图标配置")
	}
	return tools, validateDockTools(tools)
}
