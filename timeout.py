import sys
from PySide6.QtWidgets import QApplication, QWidget
from PySide6.QtCore import Qt

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
        # Calculate dimensions based on screen height as requested
        h = self.height()
        box_width = int(h * 0.48648648648)
        box_height = int(h * 0.13513513513)

        # Calculate position to center the box
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
