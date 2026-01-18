import sys
from PySide6.QtWidgets import QApplication, QWidget
from PySide6.QtCore import Qt

# ENTER YOUR ORIGINAL MONITOR PHYSICAL HEIGHT IN CM HERE
# This ensures the box stays the same physical size (cm) on all screens.
REFERENCE_SCREEN_PHYSICAL_HEIGHT_CM = 33.3

class BlankScreen(QWidget):
    def __init__(self):
        super().__init__()
        
        # Remove window frame/borders
        self.setWindowFlags(Qt.FramelessWindowHint)
        
        # Set the background color to rgb(34, 34, 34)
        self.setStyleSheet("background-color: rgb(34, 34, 34);")

        # Create the center box
        self.center_box = QWidget(self)
        self.center_box.setStyleSheet("background-color: rgb(1, 100, 172);")

    def resizeEvent(self, event):
        screen = self.screen()
        
        # 1. Calculate Target Physical Size in Millimeters (mm)
        # Based on the Reference Monitor stats
        ref_h_mm = REFERENCE_SCREEN_PHYSICAL_HEIGHT_CM * 10.0
        target_h_mm = ref_h_mm * 0.13513513513
        target_w_mm = ref_h_mm * 0.48648648648
        
        # 2. Get Current Monitor Properties
        # logical_h_px: The height in pixels the OS reports (accounts for scaling)
        # phys_h_mm: The physical height of the screen in mm (from EDID)
        logical_h_px = screen.size().height()
        phys_h_mm = screen.physicalSize().height()

        # Safety check: prevent division by zero if monitor reports invalid size
        if phys_h_mm <= 0:
            phys_h_mm = 300.0 # Default fallback to a generic laptop height

        # 3. Calculate "Logical Pixels per Millimeter"
        # This tells us how many coordinate points equal 1mm on this specific screen
        px_per_mm = logical_h_px / phys_h_mm
        
        # 4. Calculate Final Dimensions in Logical Pixels
        box_width = int(target_w_mm * px_per_mm)
        box_height = int(target_h_mm * px_per_mm)

        # 5. Center the box
        x = (self.width() - box_width) // 2
        y = (self.height() - box_height) // 2

        self.center_box.setGeometry(x, y, box_width, box_height)

    def keyPressEvent(self, event):
        # Close the application when the Escape key is pressed
        if event.key() == Qt.Key_Escape:
            self.close()

if __name__ == "__main__":
    app = QApplication(sys.argv)
    
    window = BlankScreen()
    # Display the window in full screen mode
    window.showFullScreen()
    
    sys.exit(app.exec())
