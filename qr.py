import pyqrcode

url = "http://localhost:5000/index"  # or "http://localhost:5000/index"
qr = pyqrcode.create(url)
qr.png("qrcode2.png", scale=6)  # requires 'pypng'
# Alternatively (SVG): qr.svg("qrcode1.svg", scale=6)
print("Saved qrcode1.png")