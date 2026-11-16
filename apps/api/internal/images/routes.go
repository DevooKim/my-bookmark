package images

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"mime"
	"net/http"
	"net/url"
	"strings"

	"my-bookmark/api/internal/core"
	"my-bookmark/api/internal/data"
)

const validation = "VALIDATION_ERROR"
const uploadError = "이미지 업로드 형식이 올바르지 않습니다"
const missingShare = "링크 또는 이미지 하나가 필요합니다"
const columns = "id,user_id,kind,url,title,description,site_name,favicon_url,og_image_url,category_id,tags,metadata,ai_status,ai_model,image_original_path,image_thumbnail_path,image_mime_type,image_file_size,image_width,image_height,image_filename,created_at,updated_at"

type routeError struct {
	status        int
	code, message string
}

func (e *routeError) Error() string { return e.message }
func bad(message string) error      { return &routeError{400, validation, message} }
func tooLarge() error {
	return &routeError{413, validation, "이미지는 20MB 이하여야 합니다"}
}
func writeError(w http.ResponseWriter, err error) {
	switch e := err.(type) {
	case *routeError:
		core.Error(w, e.status, e.code, e.message)
	case *processingError:
		core.Error(w, e.status, validation, e.message)
	default:
		log.Printf("image request failed: %v", err)
		core.Error(w, 500, "INTERNAL", "Internal server error")
	}
}
func uuid() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	b[6] = b[6]&15 | 64
	b[8] = b[8]&63 | 128
	var out [36]byte
	hex.Encode(out[0:8], b[0:4])
	out[8] = '-'
	hex.Encode(out[9:13], b[4:6])
	out[13] = '-'
	hex.Encode(out[14:18], b[6:8])
	out[18] = '-'
	hex.Encode(out[19:23], b[8:10])
	out[23] = '-'
	hex.Encode(out[24:36], b[10:16])
	return string(out[:]), nil
}

func createImage(ctx context.Context, app *core.App, userID string, raw []byte, filename string) (map[string]any, error) {
	image, err := processImage(raw, filename, true, false)
	if err != nil {
		return nil, err
	}
	id, err := uuid()
	if err != nil {
		return nil, err
	}
	store := newStorage(app)
	original := userID + "/" + id + "/original." + image.Extension
	thumbnail := userID + "/" + id + "/thumbnail.webp"
	if err := store.upload(ctx, original, image.Original, image.MIMEType); err != nil {
		return nil, err
	}
	if err := store.upload(ctx, thumbnail, image.Thumbnail, "image/webp"); err != nil {
		if cleanup := store.remove(context.WithoutCancel(ctx), original); cleanup != nil {
			log.Printf("image original cleanup failed: %v", cleanup)
		}
		return nil, err
	}
	row := map[string]any{"id": id, "user_id": userID, "kind": "image", "url": nil, "image_original_path": original, "image_thumbnail_path": thumbnail, "image_mime_type": image.MIMEType, "image_file_size": len(raw), "image_width": image.Width, "image_height": image.Height, "image_filename": image.Filename, "ai_status": "pending"}
	headers := http.Header{"Prefer": []string{"return=representation"}}
	rawRow, status, err := app.DB(ctx, http.MethodPost, "bookmarks", url.Values{"select": []string{columns}}, row, headers)
	var rows []map[string]any
	if err == nil && (status < 200 || status >= 300) {
		err = fmt.Errorf("bookmark insert returned %d", status)
	}
	if err == nil {
		err = json.Unmarshal(rawRow, &rows)
		if err == nil && len(rows) != 1 {
			err = fmt.Errorf("bookmark insert returned %d rows", len(rows))
		}
	}
	if err != nil {
		if cleanup := store.remove(context.WithoutCancel(ctx), original, thumbnail); cleanup != nil {
			log.Printf("image storage cleanup failed: %v", cleanup)
		}
		return nil, err
	}
	if app.Categorize != nil {
		go app.Categorize(context.WithoutCancel(ctx), userID, id)
	}
	var signed any
	if value, err := store.sign(ctx, thumbnail); err == nil {
		signed = value
	} else {
		log.Printf("image thumbnail signing failed: %v", err)
	}
	r := rows[0]
	metadata := r["metadata"]
	if metadata == nil {
		metadata = map[string]any{}
	}
	return map[string]any{"id": r["id"], "userId": r["user_id"], "kind": r["kind"], "url": r["url"], "image": map[string]any{"thumbnailUrl": signed, "originalUrl": nil, "mimeType": r["image_mime_type"], "fileSize": r["image_file_size"], "width": r["image_width"], "height": r["image_height"], "filename": r["image_filename"]}, "title": r["title"], "description": r["description"], "siteName": r["site_name"], "faviconUrl": r["favicon_url"], "ogImageUrl": r["og_image_url"], "categoryId": r["category_id"], "tags": r["tags"], "metadata": metadata, "aiStatus": r["ai_status"], "aiModel": r["ai_model"], "places": []any{}, "createdAt": r["created_at"], "updatedAt": r["updated_at"]}, nil
}

type formItem struct {
	text     string
	bytes    []byte
	filename string
	file     bool
	count    int
}

func readMultipart(r *http.Request, field string, strict bool) (formItem, error) {
	var item formItem
	mr, err := r.MultipartReader()
	if err != nil {
		return item, bad(uploadError)
	}
	for {
		part, err := mr.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			return item, bad(uploadError)
		}
		name, filename := part.FormName(), part.FileName()
		item.count++
		if strict && item.count > 1 {
			part.Close()
			return item, bad(uploadError)
		}
		if filename != "" {
			if name != field || item.file {
				part.Close()
				return item, bad(uploadError)
			}
			b, err := io.ReadAll(io.LimitReader(part, MaxImageBytes+1))
			part.Close()
			if err != nil {
				return item, bad(uploadError)
			}
			if len(b) > MaxImageBytes {
				return item, tooLarge()
			}
			item.file, item.bytes, item.filename = true, b, filename
		} else {
			limit := int64(1024 * 1024)
			if strict {
				limit = 8192
			}
			b, err := io.ReadAll(io.LimitReader(part, limit+1))
			part.Close()
			if err != nil || int64(len(b)) > limit {
				return item, bad(uploadError)
			}
			if strict {
				if name != field {
					return item, bad(missingShare)
				}
				item.text = string(b)
			}
		}
	}
	return item, nil
}
func Register(mux *http.ServeMux, app *core.App) {
	mux.HandleFunc("POST /api/images", func(w http.ResponseWriter, r *http.Request) {
		mediaType, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
		if mediaType != "multipart/form-data" {
			writeError(w, bad("이미지 파일이 필요합니다"))
			return
		}
		item, err := readMultipart(r, "image", false)
		if err != nil {
			writeError(w, err)
			return
		}
		if !item.file {
			writeError(w, bad("이미지 파일이 필요합니다"))
			return
		}
		bookmark, err := createImage(r.Context(), app, core.UserID(r), item.bytes, item.filename)
		if err != nil {
			writeError(w, err)
			return
		}
		core.JSON(w, 201, map[string]any{"bookmark": bookmark})
	})
	mux.HandleFunc("POST /api/share", func(w http.ResponseWriter, r *http.Request) {
		var item formItem
		var err error
		mediaType, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
		switch mediaType {
		case "multipart/form-data":
			item, err = readMultipart(r, "item", true)
		case "application/x-www-form-urlencoded":
			body, readErr := io.ReadAll(io.LimitReader(r.Body, 8193))
			if readErr != nil || len(body) > 8192 {
				err = bad(missingShare)
				break
			}
			values, parseErr := url.ParseQuery(string(body))
			if parseErr != nil || len(values) != 1 || len(values["item"]) != 1 {
				err = bad(missingShare)
				break
			}
			item.text = values.Get("item")
			item.count = 1
		case "application/json":
			var values map[string]json.RawMessage
			if core.Decode(r, &values) != nil || len(values) != 1 || json.Unmarshal(values["item"], &item.text) != nil {
				err = bad(missingShare)
				break
			}
			item.count = 1
		default:
			err = bad(missingShare)
		}
		if err != nil {
			writeError(w, err)
			return
		}
		if item.count != 1 || (!item.file && item.text == "") {
			writeError(w, bad(missingShare))
			return
		}
		var bookmark map[string]any
		if item.file {
			bookmark, err = createImage(r.Context(), app, core.UserID(r), item.bytes, item.filename)
			if err != nil {
				writeError(w, err)
				return
			}
		} else {
			parsed, parseErr := url.Parse(item.text)
			if parseErr != nil || parsed.Scheme == "" || strings.ContainsAny(item.text, "\r\n\t ") || ((parsed.Scheme == "http" || parsed.Scheme == "https") && parsed.Host == "") {
				core.Error(w, 400, validation, "Validation failed")
				return
			}
			bookmark, err = data.CreateLinkBookmark(r.Context(), app, core.UserID(r), data.CreateBookmarkInput{URL: item.text, Mode: "ai"})
			if err != nil {
				data.WriteError(w, err)
				return
			}
		}
		core.JSON(w, 201, map[string]any{"bookmark": bookmark})
	})
}
