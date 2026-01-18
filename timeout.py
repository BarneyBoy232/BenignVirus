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
