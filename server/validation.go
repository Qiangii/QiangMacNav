package main

import (
	"database/sql"
	"net/http"
	"strings"
	"unicode/utf8"
)

func textLength(value string, minLength, maxLength int) bool {
	n := utf8.RuneCountInString(value)
	return utf8.ValidString(value) && n >= minLength && n <= maxLength
}

type siteInput struct {
	Name, URL, Note, LogoURL string
	CategoryID               *string
}

func (a *app) validateSite(w http.ResponseWriter, input *siteInput, owner string) bool {
	input.Name = strings.TrimSpace(input.Name)
	input.Note = strings.TrimSpace(input.Note)
	var valid bool
	input.URL, valid = normalizedURL(input.URL)
	if !textLength(input.Name, 1, 100) || !textLength(input.Note, 0, 500) || !valid {
		fail(w, 400, "网站名称须为 1–100 个字符，备注最多 500 个字符，并填写有效网址")
		return false
	}
	if input.LogoURL, valid = a.normalizedIconURL(input.LogoURL, owner); !valid {
		fail(w, 400, "无效的网站图标地址")
		return false
	}
	return true
}

func readIDs(rows *sql.Rows) ([]string, error) {
	defer rows.Close()
	ids := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}
