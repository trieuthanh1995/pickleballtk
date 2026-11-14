PICKLE BALL - BẠN NÓI THẾ RỒI OK ĐI  (có chơi online)
=====================================================
Gồm: index.html, assets/ (game), server.js + game-server.js + ws-lite.js (server riêng).
Không cần cài thư viện nào. Chỉ cần Node.js 18 trở lên.

1) CHẠY THỬ TRÊN MÁY
   node server.js            -> mở http://localhost:3000
   Mở 2 tab (hoặc 2 máy cùng wifi: http://IP-máy-bạn:3000) để thử online.

2) ĐƯA LÊN LINK RIÊNG ĐỂ BẠN BÈ CHƠI (Render.com, miễn phí)
   a. Tạo tài khoản github.com, tạo repo mới (New repository), bấm "uploading an existing file",
      kéo thả TOÀN BỘ file/thư mục trong thư mục này lên, bấm Commit.
   b. Tạo tài khoản render.com, bấm New > Web Service > chọn repo vừa tạo.
   c. Điền: Runtime = Node | Build Command = (để trống) | Start Command = node server.js | Instance = Free.
   d. Bấm Create. Vài phút sau có link dạng https://ten-ban-chon.onrender.com
      Gửi link này cho bạn bè là chơi được.
   Lưu ý gói Free: không ai vào một lúc thì server "ngủ", người vào đầu tiên chờ ~30-60 giây.
   Bảng xếp hạng lưu trong file tạm nên có thể bị xóa khi server khởi động lại.

3) CÁCH CHƠI ONLINE VỚI BẠN BÈ
   Menu > Chơi online > nhập tên > "Tạo phòng" (1v1 hoặc 2v2) > đọc mã 4 ký tự cho bạn bè.
   Bạn bè: Chơi online > nhập mã > Vào phòng > bấm "Sẵn sàng". Chủ phòng bấm "Bắt đầu".
   2v2 thiếu người: chủ phòng bật "Bot thay chỗ trống". Cũng có "Ghép nhanh" và "Xem trực tiếp".

4) SỬA NHANH
   Tên nhân vật / màu / sân : assets/config.js
   Tên game                 : assets/config.js (GAME_NAME), index.html (thẻ <title> và <h1 class="logo">)

5) BẢN v4 – TỦ ĐỒ VIP
   - Ảnh mẫu (nút "⬇ Ảnh mẫu") đã ghi rõ kích thước; mỗi ô kit cũng hiện cỡ ảnh nên dùng:
       Áo      1024 x 512  px (tỉ lệ 2:1)   - tối thiểu 512 x 256
       Quần/Váy 1024 x 256 px (tỉ lệ 4:1)   - tối thiểu 512 x 128
       Vợt     700 x 1008  px (tỉ lệ 25:36) - tối thiểu 350 x 504
   - Chọn ảnh xong sẽ mở trình chỉnh: kéo để dời, cuộn/chụm để phóng to - thu nhỏ, lật ngang, đổi nền.
   - Kiểu áo mới trong Tủ đồ: "Váy xòe công chúa" và "Vest lịch lãm".

6) BẢN v5 – DÒ PHÒNG + CHAT THOẠI
   - Sảnh online có mục "Phòng đang mở": thấy ngay phòng người khác vừa tạo, bấm "Vào". Tự làm mới mỗi 3 giây.
   - "Tìm trận 1v1/2v2" giờ TỰ VÀO phòng đang chờ của người khác (trước đây chỉ ghép với người cũng bấm Tìm trận,
     nên phòng do "Tạo phòng" không bao giờ được tìm thấy). Muốn phòng chỉ vào bằng mã: tick "Phòng riêng" khi tạo.
   - Mục "Trận đang diễn ra": bấm Xem để xem trực tiếp, không cần nhập mã.
   - Chat thoại: nút "Bật chat thoại" trong phòng và nút mic ở góc phải trong trận (giữ phím T để nói khi ở chế độ giữ-để-nói).
     Âm thanh đi thẳng giữa các máy (WebRTC); server chỉ chuyển tin báo hiệu, không nhận / lưu âm thanh.
   - Cần HTTPS (Render có sẵn) hoặc localhost thì trình duyệt mới cho dùng micro.
   - Để nối được ở mọi loại mạng (4G, wifi công ty) nên thêm máy chủ TURN. Đặt biến môi trường trên Render:
       TURN_URL   = turn:tên-máy-chủ:443?transport=tcp   (nhiều địa chỉ: ngăn cách bằng dấu phẩy)
       TURN_USER  = tên đăng nhập
       TURN_PASS  = mật khẩu
     hoặc ICE_SERVERS = chuỗi JSON mảng iceServers do nhà cung cấp (Metered, Cloudflare, Twilio…) đưa cho bạn.
     Kiểm tra tại  https://tên-game.onrender.com/ice
