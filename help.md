# Thuyết trình dự án Web Radar và Theo dõi đối tượng

## 1. Tổng quan hệ thống
- **Mục tiêu dự án**: Xây dựng hệ thống nhận diện, theo dõi và tương tác với đối tượng
- **Kiến trúc tổng thể**: Kết hợp cảm biến siêu âm, servos, ESP32 CAM và xử lý hình ảnh
- **Hai chế độ hoạt động chính**: Chế độ quét radar và chế độ theo dõi đối tượng

## 2. Phần cứng hệ thống

### 2.1. Module ESP32 CAM
- **Vai trò**: Vi điều khiển trung tâm, xử lý logic phần cứng và camera
- **Đặc điểm kỹ thuật**:
  - Chip ESP32-S với WiFi tích hợp
  - Camera OV2640 tích hợp (2MP)
  - GPIO giới hạn nhưng đủ để điều khiển servo và cảm biến
  - Giao tiếp Serial để kết nối với máy tính

### 2.2. Cảm biến siêu âm
- **Nguyên lý hoạt động**: Phát và thu sóng siêu âm để tính khoảng cách
- **Kết nối với ESP32 CAM**:
  - Chân Trigger: IO2
  - Chân Echo: IO14
- **Ứng dụng**: Đo khoảng cách đến đối tượng trong chế độ radar

### 2.3. Servo Motors
- **Servo Radar**: Quay để quét không gian xung quanh
  - Kết nối với ESP32 qua IO12
  - Góc quét từ 15° đến 165°
- **Servo Theo dõi**:
  - Servo ngang (left/right): IO13
  - Servo dọc (up/down): IO15
  - Đồng bộ chuyển động theo tọa độ khuôn mặt/tay

## 3. Phần mềm và xử lý hình ảnh

### 3.1. MediaPipe Framework
- **Công nghệ Google**: Framework xử lý hình ảnh thời gian thực
- **Các mô hình sử dụng**:
  - Face Detection: Nhận diện khuôn mặt
  - Hand Tracking: Theo dõi vị trí bàn tay
- **Ưu điểm**:
  - Nhẹ, chạy trên CPU thông thường
  - Độ chính xác cao
  - Trích xuất tọa độ đặc trưng (landmarks)

### 4.1. Serial Communication
- **Kết nối ESP32-Computer**: Truyền dữ liệu qua cổng USB/Serial
- **Định dạng dữ liệu**:
  - Dữ liệu radar: "góc,khoảng_cách."
  - Lệnh tracking: "x,y" (tọa độ đối tượng)
  - Lệnh điều khiển: "SHOOT", "SET_ANGLE:xx"

## 5. Ứng dụng thực tế

### 5.1. An ninh và giám sát
- Phát hiện chuyển động tự động
- Theo dõi đối tượng di chuyển
- Lưu hình ảnh đối tượng

### 5.2. Tương tác người-máy
- Điều khiển thiết bị bằng cử chỉ
- Theo dõi vị trí người dùng

### 5.3. Robot tự hành
- Phát hiện và né tránh vật cản
- Nhận diện và theo dõi mục tiêu

##6. Kết luận và hướng phát triển

### 6.1. Tóm tắt hệ thống
- Kết hợp thành công cảm biến siêu âm, camera, và xử lý hình ảnh
- Giao diện web trực quan để theo dõi và điều khiển

### 6.2. Hướng phát triển
- Thêm khả năng nhận diện đối tượng cụ thể
- Tích hợp với hệ thống IoT
- Giảm độ trễ và tăng độ chính xác của hệ thống theo dõi
