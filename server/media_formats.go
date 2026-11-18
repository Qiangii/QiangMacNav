package main

import "encoding/binary"

// Bound animated GIF decoding by actual frame rectangles before allocating all frames.
func validGIFBudget(data []byte) bool {
	if len(data) < 13 {
		return false
	}
	pos := 13
	if data[10]&0x80 != 0 {
		pos += 3 * (1 << ((data[10] & 7) + 1))
	}
	var pixels uint64
	frames := 0
	skipBlocks := func() bool {
		for pos < len(data) {
			n := int(data[pos])
			pos++
			if n == 0 {
				return true
			}
			if n > len(data)-pos {
				return false
			}
			pos += n
		}
		return false
	}
	for pos < len(data) {
		kind := data[pos]
		pos++
		switch kind {
		case 0x3b:
			return frames > 0
		case 0x21:
			if pos >= len(data) {
				return false
			}
			pos++
			if !skipBlocks() {
				return false
			}
		case 0x2c:
			if len(data)-pos < 9 {
				return false
			}
			width := binary.LittleEndian.Uint16(data[pos+4:])
			height := binary.LittleEndian.Uint16(data[pos+6:])
			pixels += uint64(width) * uint64(height)
			frames++
			if frames > 1000 || pixels > 100000000 {
				return false
			}
			packed := data[pos+8]
			pos += 9
			if packed&0x80 != 0 {
				pos += 3 * (1 << ((packed & 7) + 1))
			}
			if pos >= len(data) {
				return false
			}
			pos++
			if !skipBlocks() {
				return false
			}
		default:
			return false
		}
	}
	return false
}

type mp4Box struct {
	kind string
	data []byte
}

func mp4Boxes(raw []byte) ([]mp4Box, bool) {
	boxes := []mp4Box{}
	for len(raw) > 0 {
		if len(raw) < 8 || len(boxes) > 10000 {
			return nil, false
		}
		size := uint64(binary.BigEndian.Uint32(raw))
		header := uint64(8)
		if size == 1 {
			if len(raw) < 16 {
				return nil, false
			}
			size = binary.BigEndian.Uint64(raw[8:])
			header = 16
		}
		if size == 0 {
			size = uint64(len(raw))
		}
		if size < header || size > uint64(len(raw)) {
			return nil, false
		}
		boxes = append(boxes, mp4Box{string(raw[4:8]), raw[header:size]})
		raw = raw[size:]
	}
	return boxes, true
}

// Validate MP4 framing and a video track with dimensions; no external converter is required.
func mp4Dimensions(raw []byte) (int, int, bool) {
	boxes, ok := mp4Boxes(raw)
	if !ok {
		return 0, 0, false
	}
	var movie []byte
	ftyp, mdat := false, false
	for _, box := range boxes {
		switch box.kind {
		case "ftyp":
			ftyp = len(box.data) >= 8
		case "mdat":
			mdat = len(box.data) > 0
		case "moov":
			movie = box.data
		}
	}
	if !ftyp || !mdat {
		return 0, 0, false
	}
	children, ok := mp4Boxes(movie)
	if !ok {
		return 0, 0, false
	}
	for _, track := range children {
		if track.kind != "trak" {
			continue
		}
		parts, ok := mp4Boxes(track.data)
		if !ok {
			return 0, 0, false
		}
		width, height, video := 0, 0, false
		for _, part := range parts {
			if part.kind == "tkhd" && len(part.data) >= 84 {
				offset := 76
				if part.data[0] == 1 {
					offset = 88
				}
				if len(part.data) < offset+8 {
					return 0, 0, false
				}
				width = int(binary.BigEndian.Uint32(part.data[offset:]) >> 16)
				height = int(binary.BigEndian.Uint32(part.data[offset+4:]) >> 16)
			}
			if part.kind == "mdia" {
				media, ok := mp4Boxes(part.data)
				if !ok {
					return 0, 0, false
				}
				for _, item := range media {
					if item.kind == "hdlr" && len(item.data) >= 12 && string(item.data[8:12]) == "vide" {
						video = true
					}
				}
			}
		}
		if video && width > 0 && height > 0 && width <= 8192 && height <= 8192 {
			return width, height, true
		}
	}
	return 0, 0, false
}
