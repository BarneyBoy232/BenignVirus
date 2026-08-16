// Package firestore is a tiny REST client for the few Firestore operations the
// agent needs: list a collection (to read the manifest) and upsert a document
// (to write its heartbeat). It speaks Firestore's typed-value JSON so we don't
// need the heavy official SDK.
package firestore

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
)

const base = "https://firestore.googleapis.com/v1"

// Client talks to one Firestore project via the public web apiKey.
type Client struct {
	projectID string
	apiKey    string
	http      *http.Client
}

func New(projectID, apiKey string, hc *http.Client) *Client {
	if hc == nil {
		hc = http.DefaultClient
	}
	return &Client{projectID: projectID, apiKey: apiKey, http: hc}
}

func (c *Client) docsURL(path string) string {
	return fmt.Sprintf("%s/projects/%s/databases/(default)/documents/%s?key=%s",
		base, c.projectID, path, c.apiKey)
}

// --- typed value (de)coding --------------------------------------------

type value struct {
	StringValue  *string `json:"stringValue,omitempty"`
	IntegerValue *string `json:"integerValue,omitempty"`
	BooleanValue *bool   `json:"booleanValue,omitempty"`
	ArrayValue   *struct {
		Values []value `json:"values,omitempty"`
	} `json:"arrayValue,omitempty"`
}

// decode turns a typed value into a plain Go value (string, int64, bool, []string).
func (v value) decode() any {
	switch {
	case v.StringValue != nil:
		return *v.StringValue
	case v.IntegerValue != nil:
		n, _ := strconv.ParseInt(*v.IntegerValue, 10, 64)
		return n
	case v.BooleanValue != nil:
		return *v.BooleanValue
	case v.ArrayValue != nil:
		out := make([]string, 0, len(v.ArrayValue.Values))
		for _, e := range v.ArrayValue.Values {
			if e.StringValue != nil {
				out = append(out, *e.StringValue)
			}
		}
		return out
	}
	return nil
}

// encodeValue turns a plain Go value into a Firestore typed value.
func encodeValue(v any) map[string]any {
	switch x := v.(type) {
	case string:
		return map[string]any{"stringValue": x}
	case int:
		return map[string]any{"integerValue": strconv.Itoa(x)}
	case int64:
		return map[string]any{"integerValue": strconv.FormatInt(x, 10)}
	case bool:
		return map[string]any{"booleanValue": x}
	case []string:
		vals := make([]any, 0, len(x))
		for _, s := range x {
			vals = append(vals, map[string]any{"stringValue": s})
		}
		return map[string]any{"arrayValue": map[string]any{"values": vals}}
	default:
		return map[string]any{"stringValue": fmt.Sprint(x)}
	}
}

// --- operations --------------------------------------------------------

// List returns every document in a collection as plain field maps.
func (c *Client) List(ctx context.Context, collectionPath string) ([]map[string]any, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.docsURL(collectionPath), nil)
	if err != nil {
		return nil, err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return nil, fmt.Errorf("firestore list HTTP %d: %s", resp.StatusCode, bytes.TrimSpace(body))
	}
	var out struct {
		Documents []struct {
			Fields map[string]value `json:"fields"`
		} `json:"documents"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, err
	}
	docs := make([]map[string]any, 0, len(out.Documents))
	for _, d := range out.Documents {
		m := map[string]any{}
		for k, v := range d.Fields {
			m[k] = v.decode()
		}
		docs = append(docs, m)
	}
	return docs, nil
}

// Set upserts a document (create or overwrite) at documentPath with the fields.
func (c *Client) Set(ctx context.Context, documentPath string, fields map[string]any) error {
	encoded := map[string]any{}
	for k, v := range fields {
		encoded[k] = encodeValue(v)
	}
	body, err := json.Marshal(map[string]any{"fields": encoded})
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPatch, c.docsURL(documentPath), bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return fmt.Errorf("firestore set HTTP %d: %s", resp.StatusCode, bytes.TrimSpace(b))
	}
	return nil
}
