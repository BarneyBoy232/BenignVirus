import sys
from datetime import datetime, timedelta
from PySide6.QtWidgets import QApplication, QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton
from PySide6.QtCore import Qt

# ==================================================================================
# <<< CONFIGURATION SECTION >>>
# Change the physical height to match your reference monitor
REFERENCE_SCREEN_PHYSICAL_HEIGHT_CM = 33.3
# ==================================================================================

class BlankScreen(QWidget):
    def __init__(self):
        super().__init__()
        
        self.setWindowFlags(Qt.FramelessWindowHint)
        self.setStyleSheet("background-color: rgb(34, 34, 34);")

        self.center_box = QWidget(self)
        
        # ==================================================================================
        # <<< MAIN BOX LAYOUT SETTINGS >>>
        # Adjust margins (padding inside box) and spacing between top/bottom sections here
        # ==================================================================================
        main_layout = QVBoxLayout(self.center_box)
        main_layout.setContentsMargins(25, 18, 20, 25) # (Left, Top, Right, Bottom)
        main_layout.setSpacing(10)

        # ==================================================================================
        # <<< TEXT SECTION (TOP LEFT) >>>
        # ==================================================================================
        text_layout = QVBoxLayout()
        text_layout.setSpacing(10) # Space between Title and Subtitle
        
        # 1. Title Label
        self.title_label = QLabel("Time's Up!")
        self.title_label.setObjectName("title") # Used for styling below
        self.title_label.setAlignment(Qt.AlignLeft | Qt.AlignTop)
        
        # 2. Subtitle Label
        # Calculate tomorrow's date based on computer clock
        tomorrow = datetime.now() + timedelta(days=1)
        date_str = tomorrow.strftime("%d/%m/%Y") # Formats as DD/MM/YYYY
        
        subtitle_text = (
            "This device is locked because of your family settings for screen time. You can use it again\n"
            f"at 7:00 am on {date_str}, or ask an adult for more time today."
        )

        self.subtitle_label = QLabel(subtitle_text)
        self.subtitle_label.setObjectName("subtitle") # Used for styling below
        self.subtitle_label.setAlignment(Qt.AlignLeft | Qt.AlignTop)
        self.subtitle_label.setWordWrap(True)

        text_layout.addWidget(self.title_label)
        text_layout.addWidget(self.subtitle_label)
        
        main_layout.addLayout(text_layout)
        
        # Push everything below to the bottom
        main_layout.addStretch()

        # ==================================================================================
        # <<< BUTTON SECTION (BOTTOM RIGHT) >>>
        # ==================================================================================
        button_layout = QHBoxLayout()
        
        # --- ADJUST GAP BETWEEN BUTTONS HERE ---
        button_layout.setSpacing(20) 
        
        # Add stretch BEFORE buttons to push them to the RIGHT
        button_layout.addStretch()
        
        self.btn1 = QPushButton("Switch users or shut down")
        self.btn2 = QPushButton("Parent/guardian log in")
        self.btn3 = QPushButton("Request more time")
        
        button_layout.addWidget(self.btn1)
        button_layout.addWidget(self.btn2)
        button_layout.addWidget(self.btn3)
        
        main_layout.addLayout(button_layout)

        # ==================================================================================
        # <<< STYLESHEET / VISUALS >>>
        # Edit Colors, Fonts, Borders, and Sizes here
        # ==================================================================================
        self.center_box.setStyleSheet("""
            QWidget {
                background-color: rgb(1, 100, 172);
                color: rgb(215, 255, 255);
                font-family: 'Segoe UI', sans-serif;
            }
            
            /* --- TITLE STYLING --- */
            QLabel#title {
                font-size: 24px;
                font-weight: normal;
                border: none;
                margin: 0px;
            }
            
            /* --- SUBTITLE STYLING --- */
            QLabel#subtitle {
                font-size: 16px;
                font-weight: normal;
                border: none;
                margin: 0px;
            }
            
            /* --- BUTTON STYLING --- */
            QPushButton {
                background-color: rgb(1, 100, 172);
                border: 1px solid rgb(215, 255, 255); 
                font-size: 15px;
                font-weight: normal;
                border-radius: 0px; 
                
                /* Removed fixed min-width so buttons fit their text */
                min-width: 0px; 
                min-height: 38px;
                
                /* --- ADJUST TEXT PADDING INSIDE BUTTON HERE --- */
                /* Format: padding: [Top/Bottom]px [Left/Right]px; */
                padding: -5px 15px;
            }
            QPushButton:hover {
                background-color: rgb(31, 130, 202); 
            }
            QPushButton:pressed {
                background-color: rgb(215, 255, 255);
                color: rgb(1, 100, 172);
            }
        """)

    def resizeEvent(self, event):
        screen = self.screen()
        
        # ==================================================================================
        # <<< SIZE & POSITION CALCULATIONS >>>
        # Logic to calculate the physical size of the box
        # ==================================================================================
        
        # Physical size calculations based on your provided Reference Height
        ref_h_mm = REFERENCE_SCREEN_PHYSICAL_HEIGHT_CM * 10.0
        
        # --- CHANGE THE PROPORTIONS HERE (0.135... and 0.486...) ---
        target_h_mm = ref_h_mm * 0.13513513513
        target_w_mm = ref_h_mm * 0.48648648648
        
        logical_h_px = screen.size().height()
        phys_h_mm = screen.physicalSize().height()

        if phys_h_mm <= 0:
            phys_h_mm = 300.0

        px_per_mm = logical_h_px / phys_h_mm
        
        box_width = int(target_w_mm * px_per_mm)
        box_height = int(target_h_mm * px_per_mm)

        x = (self.width() - box_width) // 2
        y = (self.height() - box_height) // 2

        self.center_box.setGeometry(x, y, box_width, box_height)

    def keyPressEvent(self, event):
        if event.key() == Qt.Key_Escape:
            self.close()

if __name__ == "__main__":
    app = QApplication(sys.argv)
    window = BlankScreen()
    window.showFullScreen()
    sys.exit(app.exec())
