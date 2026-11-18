package updates

import (
	"os"
	"strings"
)

const DefaultRepository = "Qiangii/QiangMacNav"
const DefaultImage = "ghcr.io/qiangii/qiangmacnav"

// SourceFromEnv is shared by the application and updater so their release channels agree.
// A custom repository requires its own explicit image instead of mixing release sources.
func SourceFromEnv() Source {
	repository := strings.TrimSpace(os.Getenv("UPDATE_REPOSITORY"))
	image := strings.TrimSpace(os.Getenv("UPDATE_IMAGE"))
	if repository == "" {
		repository = DefaultRepository
	}
	if image == "" && strings.EqualFold(repository, DefaultRepository) {
		image = DefaultImage
	}
	return Source{Repository: repository, Image: image}
}
