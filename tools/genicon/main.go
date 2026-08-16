// Command genicon draws the nuclear-trefoil radiation symbol and writes it to
// a multi-size Windows .ico file. Run with: go run ./tools/genicon
//
// The .ico is used only for the USB "key" launcher (projectBV-key.exe) — the fun
// branding. The installed agent gets no custom icon (generic exe look).
package main

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/color"
	"image/png"
	"math"
	"os"
)

// Radiation-yellow background and black symbol (the classic trefoil colours).
var (
	yellow = color.RGBA{0xFF, 0xD2, 0x00, 0xFF}
	black  = color.RGBA{0x11, 0x11, 0x11, 0xFF}
	clear  = color.RGBA{0, 0, 0, 0}
)

// trefoilAt returns the colour of a single pixel (px,py) for an icon of the
// given size. It draws the classic radiation symbol: a black outer ring, a
// yellow disc inside it, and the black trefoil (central disk + three 60°-wide
// blades) on top — matching the standard sign.
func trefoilAt(px, py, size int) color.RGBA {
	fs := float64(size)
	cx, cy := fs/2, fs/2
	dx, dy := float64(px)+0.5-cx, float64(py)+0.5-cy
	d := math.Hypot(dx, dy)

	outerR := fs * 0.49 // outer edge of the black ring
	diskR := fs * 0.44  // yellow disc radius (ring is between diskR and outerR)

	if d > outerR {
		return clear // transparent outside the badge
	}
	if d > diskR {
		return black // the outer ring
	}

	// ISO trefoil geometry: central disk radius R, blades from 1.5R to 5R,
	// each blade 60° wide (±30° from its centre), centres 120° apart.
	R := fs * 0.082
	inner := 1.5 * R
	outer := 5.0 * R

	if d <= R {
		return black // central disk
	}
	if d >= inner && d <= outer {
		ang := math.Atan2(dy, dx) // -pi..pi
		// Three blade centres 120° apart: up, lower-right, lower-left.
		for _, c := range []float64{-math.Pi / 2, -math.Pi/2 + 2*math.Pi/3, -math.Pi/2 - 2*math.Pi/3} {
			delta := math.Abs(math.Mod(ang-c+3*math.Pi, 2*math.Pi) - math.Pi)
			if delta <= math.Pi/6 { // ±30°
				return black
			}
		}
	}
	return yellow
}

func render(size int) *image.RGBA {
	img := image.NewRGBA(image.Rect(0, 0, size, size))
	for y := 0; y < size; y++ {
		for x := 0; x < size; x++ {
			img.Set(x, y, trefoilAt(x, y, size))
		}
	}
	return img
}

// writeICO packs several PNG-encoded images into one .ico container. Modern
// Windows icons may store each image as a raw PNG, which keeps this simple.
func writeICO(path string, sizes []int) error {
	type entry struct {
		size int
		png  []byte
	}
	var entries []entry
	for _, s := range sizes {
		var buf bytes.Buffer
		if err := png.Encode(&buf, render(s)); err != nil {
			return err
		}
		entries = append(entries, entry{s, buf.Bytes()})
	}

	var out bytes.Buffer
	// ICONDIR header: reserved, type=1 (icon), image count.
	binary.Write(&out, binary.LittleEndian, uint16(0))
	binary.Write(&out, binary.LittleEndian, uint16(1))
	binary.Write(&out, binary.LittleEndian, uint16(len(entries)))

	offset := 6 + 16*len(entries) // header + all directory entries
	for _, e := range entries {
		b := byte(e.size)
		if e.size >= 256 {
			b = 0 // 256 is encoded as 0 in the .ico spec
		}
		out.WriteByte(b)                                              // width
		out.WriteByte(b)                                              // height
		out.WriteByte(0)                                              // palette count
		out.WriteByte(0)                                              // reserved
		binary.Write(&out, binary.LittleEndian, uint16(1))           // colour planes
		binary.Write(&out, binary.LittleEndian, uint16(32))          // bits per pixel
		binary.Write(&out, binary.LittleEndian, uint32(len(e.png)))  // bytes of image
		binary.Write(&out, binary.LittleEndian, uint32(offset))      // offset to image
		offset += len(e.png)
	}
	for _, e := range entries {
		out.Write(e.png)
	}
	return os.WriteFile(path, out.Bytes(), 0644)
}

func main() {
	if err := writeICO("assets/trefoil.ico", []int{16, 24, 32, 48, 64, 128, 256}); err != nil {
		panic(err)
	}
	// Also drop a 256px PNG preview so the symbol can be eyeballed easily.
	f, _ := os.Create("assets/trefoil-preview.png")
	defer f.Close()
	png.Encode(f, render(256))
}
