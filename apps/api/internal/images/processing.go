package images

import (
	"bytes"
	"fmt"
	"image/png"
	"path"
	"strings"

	"github.com/gen2brain/heic"
	"github.com/h2non/bimg"
)

const MaxImageBytes = 20 * 1024 * 1024
const maxPixels = 64_000_000

type processingError struct {
	status  int
	message string
}

func (e *processingError) Error() string { return e.message }

type ProcessedImage struct {
	Original, Thumbnail, AnalysisImage []byte
	Extension, MIMEType, Filename      string
	Width, Height                      int
}

// ProcessImage validates and decodes an image, keeping the original untouched.
func ProcessImage(raw []byte, filename string) (*ProcessedImage, error) {
	return processImage(raw, filename, true, true)
}

func processImage(raw []byte, filename string, needThumbnail, needAnalysis bool) (*ProcessedImage, error) {
	if len(raw) > MaxImageBytes {
		return nil, &processingError{413, "이미지는 20MB 이하여야 합니다"}
	}
	invalid := func() error { return &processingError{400, "이미지 파일을 읽을 수 없습니다"} }
	extension := strings.ToLower(path.Ext(filename))
	isHEIF := extension == ".heic" || extension == ".heif"
	if len(raw) >= 12 && string(raw[4:8]) == "ftyp" {
		switch string(raw[8:12]) {
		case "heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1":
			isHEIF = true
		}
	}
	input := raw
	var format, mime string
	var width, height int
	if isHEIF {
		cfg, err := heic.DecodeConfig(bytes.NewReader(raw))
		if err != nil {
			return nil, invalid()
		}
		if cfg.Width <= 0 || cfg.Height <= 0 || int64(cfg.Width)*int64(cfg.Height) > maxPixels {
			return nil, &processingError{400, "이미지 크기를 처리할 수 없습니다"}
		}
		decoded, err := heic.Decode(bytes.NewReader(raw))
		if err != nil {
			return nil, invalid()
		}
		width, height = decoded.Bounds().Dx(), decoded.Bounds().Dy()
		var buf bytes.Buffer
		if err := png.Encode(&buf, decoded); err != nil {
			return nil, invalid()
		}
		input = buf.Bytes()
		format = "heic"
		if extension == ".heif" {
			format = "heif"
		}
		mime = "image/" + format
	} else {
		meta, err := bimg.Metadata(raw)
		if err != nil {
			return nil, invalid()
		}
		width, height = meta.Size.Width, meta.Size.Height
		if width <= 0 || height <= 0 || int64(width)*int64(height) > maxPixels {
			return nil, &processingError{400, "이미지 크기를 처리할 수 없습니다"}
		}
		switch meta.Type {
		case "jpeg":
			format, mime = "jpg", "image/jpeg"
		case "png":
			format, mime = "png", "image/png"
		case "gif":
			format, mime = "gif", "image/gif"
		case "webp":
			format, mime = "webp", "image/webp"
		default:
			return nil, &processingError{415, "지원하지 않는 이미지 형식입니다"}
		}
		if meta.Orientation >= 5 && meta.Orientation <= 8 {
			width, height = height, width
		}
	}
	var thumbnail, analysis []byte
	var err error
	if needThumbnail {
		thumbWidth, thumbHeight := fit(width, height, 640)
		thumbnail, err = bimg.NewImage(input).Process(bimg.Options{Width: thumbWidth, Height: thumbHeight, Type: bimg.WEBP, Quality: 78, OutputICC: "srgb"})
		if err != nil {
			return nil, invalid()
		}
	}
	if needAnalysis {
		analysisWidth, analysisHeight := fit(width, height, 2048)
		analysis, err = bimg.NewImage(input).Process(bimg.Options{Width: analysisWidth, Height: analysisHeight, Type: bimg.JPEG, Quality: 85, OutputICC: "srgb"})
		if err != nil {
			return nil, invalid()
		}
	}
	name := strings.TrimSpace(path.Base(filename))
	if name == "." || name == "" {
		name = fmt.Sprintf("image.%s", format)
	}
	runes := []rune(name)
	if len(runes) > 255 {
		name = string(runes[:255])
	}
	return &ProcessedImage{Original: raw, Thumbnail: thumbnail, AnalysisImage: analysis, Extension: format, MIMEType: mime, Filename: name, Width: width, Height: height}, nil
}

func fit(width, height, limit int) (int, int) {
	if width <= limit && height <= limit {
		return width, height
	}
	if width >= height {
		h := (height*limit + width/2) / width
		if h < 1 {
			h = 1
		}
		return limit, h
	}
	w := (width*limit + height/2) / height
	if w < 1 {
		w = 1
	}
	return w, limit
}
