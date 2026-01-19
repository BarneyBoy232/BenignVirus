import tkinter as tk
from tkinter import ttk, messagebox
import subprocess
import threading
import socket
import os

# --- CONFIGURATION ---
# These must match your All_In_One_Install.bat settings
REMOTE_PASSWORD = "Control123!"
RUSTDESK_PATH = r"C:\Program Files\RustDesk\rustdesk.exe"
NETWORK_PREFIX = "192.168.1."  # Adjust to your Wi-Fi subnet

class PCCard(tk.Frame):
    """Visual card representing a single PC."""
    def __init__(self, parent, ip, on_select):
        super().__init__(parent, bg="#2d3748", padx=10, pady=10, highlightthickness=2, highlightbackground="#4a5568")
        self.ip = ip
        self.on_select = on_select
        self.selected = False

        # UI Elements
        self.label_name = tk.Label(self, text=f"💻 PC-{ip.split('.')[-1]}", bg="#2d3748", fg="#63b3ed", font=("Arial", 12, "bold"))
        self.label_name.pack(anchor="w")

        self.label_ip = tk.Label(self, text=ip, bg="#2d3748", fg="#a0aec0", font=("Arial", 10))
        self.label_ip.pack(anchor="w")

        self.label_status = tk.Label(self, text="● Online", bg="#2d3748", fg="#48bb78", font=("Arial", 9))
        self.label_status.pack(anchor="w", pady=(5, 0))

        # Bind click events
        for widget in [self, self.label_name, self.label_ip, self.label_status]:
            widget.bind("<Button-1>", self._handle_click)

    def _handle_click(self, event):
        self.on_select(self)

    def set_highlight(self, is_selected):
        self.selected = is_selected
        color = "#4299e1" if is_selected else "#4a5568"
        self.config(highlightbackground=color)

class App:
    def __init__(self, root):
        self.root = root
        self.root.title("PC Deployment Control Center")
        self.root.geometry("900x600")
        self.root.configure(bg="#1a202c")

        self.selected_card = None
        self.pc_cards = []

        self._setup_ui()
        self.refresh_list()

    def _setup_ui(self):
        # Header
        header = tk.Frame(self.root, bg="#2d3748", pady=20)
        header.pack(fill="x")
        
        title = tk.Label(header, text="Network Control Panel", bg="#2d3748", fg="white", font=("Arial", 18, "bold"))
        title.pack(side="left", padx=20)

        self.btn_refresh = tk.Button(header, text="Scan Network", command=self.refresh_list, bg="#4a5568", fg="white", relief="flat", padx=15)
        self.btn_refresh.pack(side="right", padx=20)

        # Main Content Area (Scrollable)
        self.canvas = tk.Canvas(self.root, bg="#1a202c", highlightthickness=0)
        self.scrollbar = ttk.Scrollbar(self.root, orient="vertical", command=self.canvas.yview)
        self.scrollable_frame = tk.Frame(self.canvas, bg="#1a202c")

        self.scrollable_frame.bind(
            "<Configure>",
            lambda e: self.canvas.configure(scrollregion=self.canvas.bbox("all"))
        )

        self.canvas.create_window((0, 0), window=self.scrollable_frame, anchor="nw")
        self.canvas.configure(yscrollcommand=self.scrollbar.set)

        self.canvas.pack(side="left", fill="both", expand=True, padx=20, pady=20)
        self.scrollbar.pack(side="right", fill="y")

        # Footer Action Bar
        self.footer = tk.Frame(self.root, bg="#2d3748", pady=15)
        self.footer.pack(fill="x", side="bottom")

        self.status_text = tk.Label(self.footer, text="Select a PC to begin...", bg="#2d3748", fg="#cbd5e0")
        self.status_text.pack(side="left", padx=20)

        self.btn_connect = tk.Button(
            self.footer, 
            text="CONFIRM CONNECTION", 
            command=self.connect_to_selected, 
            bg="#3182ce", 
            fg="white", 
            state="disabled",
            font=("Arial", 10, "bold"),
            relief="flat",
            padx=20,
            pady=5
        )
        self.btn_connect.pack(side="right", padx=20)

    def on_pc_selected(self, card):
        if self.selected_card:
            self.selected_card.set_highlight(False)
        
        self.selected_card = card
        self.selected_card.set_highlight(True)
        self.btn_connect.config(state="normal", bg="#38a169")
        self.status_text.config(text=f"Ready to connect to {card.ip}")

    def refresh_list(self):
        # Clear existing
        for card in self.pc_cards:
            card.destroy()
        self.pc_cards = []
        self.status_text.config(text="Scanning network...")
        
        # Run scan in thread to keep UI alive
        threading.Thread(target=self._scan_ips, daemon=True).start()

    def _scan_ips(self):
        # For demo purposes, we scan a range. In production, use a fast ping or ARP.
        found_ips = []
        for i in range(1, 255):
            ip = f"{NETWORK_PREFIX}{i}"
            # Quick check if IP is alive (port 3389 or ping)
            # This is a placeholder; you'd likely use a specific discovery method
            if self._is_alive(ip):
                found_ips.append(ip)
        
        self.root.after(0, lambda: self._populate_ui(found_ips))

    def _is_alive(self, ip):
        # Try a quick socket connection to the RustDesk port (default 21116) or ping
        try:
            # Short timeout to keep scan moving
            socket.create_connection((ip, 21116), timeout=0.1).close()
            return True
        except:
            return False

    def _populate_ui(self, ips):
        if not ips:
            self.status_text.config(text="No PCs found. Ensure they are prepped.")
            return

        cols = 3
        for idx, ip in enumerate(ips):
            card = PCCard(self.scrollable_frame, ip, self.on_pc_selected)
            card.grid(row=idx // cols, column=idx % cols, padx=10, pady=10, sticky="nsew")
            self.pc_cards.append(card)
        
        self.status_text.config(text=f"Found {len(ips)} active PCs.")

    def connect_to_selected(self):
        if not self.selected_card:
            return

        ip = self.selected_card.ip
        if not os.path.exists(RUSTDESK_PATH):
            messagebox.showerror("Error", f"RustDesk not found at {RUSTDESK_PATH}")
            return

        # Launch RustDesk via CLI
        try:
            # Functionally calling RustDesk to connect
            subprocess.Popen([
                RUSTDESK_PATH, 
                "--remote-host", ip, 
                "--password", REMOTE_PASSWORD
            ])
            self.status_text.config(text=f"Connecting to {ip}...")
        except Exception as e:
            messagebox.showerror("Connection Failed", str(e))

if __name__ == "__main__":
    root = tk.Tk()
    app = App(root)
    root.mainloop()
