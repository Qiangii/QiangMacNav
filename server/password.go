package main

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"unicode"

	"golang.org/x/crypto/bcrypt"
)

const passwordHint = "密码长度应为 6–16 位，且至少包含字母、数字、符号中的两类。"
const passwordHashPrefix = "bcrypt-sha256$"

func validPasswordLength(password string) bool {
	return textLength(password, 6, 16)
}

func validPassword(password string) bool {
	if !validPasswordLength(password) {
		return false
	}
	var letters, digits, symbols bool
	for _, c := range password {
		switch {
		case unicode.IsLetter(c):
			letters = true
		case unicode.IsDigit(c):
			digits = true
		default:
			symbols = true
		}
	}
	return letters && digits || letters && symbols || digits && symbols
}

// Prehash the complete UTF-8 password so bcrypt's byte limit does not truncate
// passwords that meet the character limit. Domain separation avoids using a
// generic password digest; bcrypt still supplies its random salt and work factor.
func passwordInput(password string) []byte {
	digest := sha256.Sum256([]byte("QiangMacNav/password/v1\x00" + password))
	return []byte(hex.EncodeToString(digest[:]))
}

func hashPassword(password string) ([]byte, error) {
	hash, err := bcrypt.GenerateFromPassword(passwordInput(password), bcrypt.DefaultCost)
	if err != nil {
		return nil, err
	}
	return append([]byte(passwordHashPrefix), hash...), nil
}

func comparePassword(hash []byte, password string) error {
	encoded, ok := strings.CutPrefix(string(hash), passwordHashPrefix)
	if !ok {
		return bcrypt.ErrMismatchedHashAndPassword
	}
	return bcrypt.CompareHashAndPassword([]byte(encoded), passwordInput(password))
}
