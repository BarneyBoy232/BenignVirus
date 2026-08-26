package main

import (
	"fmt"
	"projectbv/internal/winutil"
)

func main() {
	exe := `C:\Windows\System32\cmd.exe`
	if err := winutil.InstallLogonTask(exe); err != nil {
		fmt.Println("INSTALL FAIL:", err)
		return
	}
	fmt.Println("install ok")
}
