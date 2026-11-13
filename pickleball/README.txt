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
