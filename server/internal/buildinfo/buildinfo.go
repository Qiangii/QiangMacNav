package buildinfo

import (
	_ "embed"
	"strings"
)

//go:embed version.txt
var sourceVersion string

var Commit = "development"
var BuiltAt = ""

func Version() string { return strings.TrimSpace(sourceVersion) }

type Info struct {
	Version string `json:"version"`
	Commit  string `json:"commit"`
	BuiltAt string `json:"builtAt"`
}

func Current() Info { return Info{Version(), Commit, BuiltAt} }
