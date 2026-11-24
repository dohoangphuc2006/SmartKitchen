"use strict";

// Acquisition only. No detector, HTTP request, ranking or persistent image storage.
(function (root) {
  class SmartKitchenCamera {
    constructor({video, onState = () => {}, onError = () => {},
      mediaDevices = root.navigator?.mediaDevices, secureContext = () => root.isSecureContext,
      createCanvas = () => root.document.createElement("canvas")}) {
      this.video = video;
      this.onState = onState;
      this.onError = onError;
      this.mediaDevices = mediaDevices;
      this.secureContext = secureContext;
      this.createCanvas = createCanvas;
      this.stream = null;
      this.state = "idle";
      this.generation = 0;
      this.endedListeners = [];
    }

    emit(state) { this.state = state; this.onState(state); }

    stop() {
      this.generation += 1; // invalidates pending permission, playback AND encoding.
      for (const [track, listener] of this.endedListeners) track.removeEventListener("ended", listener);
      this.endedListeners = [];
      if (this.stream) for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
      this.video.pause();
      this.video.srcObject = null;
      this.emit("idle");
    }

    errorMessage(error) {
      const messages = {
        NotAllowedError: "Bạn chưa cho phép truy cập camera. Hãy cấp quyền trong trình duyệt hoặc chọn ảnh từ thiết bị.",
        PermissionDeniedError: "Quyền camera bị từ chối. Bạn vẫn có thể tải ảnh lên.",
        NotFoundError: "Không tìm thấy camera trên thiết bị. Bạn vẫn có thể tải ảnh lên.",
        DevicesNotFoundError: "Không tìm thấy camera trên thiết bị. Bạn vẫn có thể tải ảnh lên.",
        NotReadableError: "Không đọc được camera; camera có thể đang được ứng dụng khác sử dụng.",
        TrackStartError: "Không mở được camera. Hãy kiểm tra thiết bị và ứng dụng đang sử dụng camera.",
        OverconstrainedError: "Camera không đáp ứng cấu hình trình duyệt yêu cầu. Hãy thử camera khác hoặc tải ảnh lên.",
        SecurityError: "Trình duyệt chặn camera. Hãy dùng HTTPS hoặc localhost và kiểm tra quyền truy cập.",
        AbortError: "Việc mở camera bị gián đoạn. Bạn có thể thử mở lại."
      };
      return messages[error?.name] || "Không thể mở camera. Hãy kiểm tra quyền, thiết bị hoặc chọn ảnh tải lên.";
    }

    async start() {
      this.stop();
      if (!this.secureContext()) {
        this.onError("Camera cần HTTPS hoặc localhost. Điện thoại truy cập địa chỉ LAN qua HTTP có thể không dùng được camera; hãy dùng HTTPS hoặc tải ảnh lên.");
        return false;
      }
      if (!this.mediaDevices?.getUserMedia) {
        this.onError("Trình duyệt không hỗ trợ camera trực tiếp. Bạn vẫn có thể chọn ảnh từ thiết bị.");
        return false;
      }
      const generation = this.generation;
      this.emit("opening");
      try {
        const stream = await this.mediaDevices.getUserMedia({audio: false, video: {
          facingMode: {ideal: "environment"}, width: {ideal: 1280}, height: {ideal: 720}
        }});
        if (generation !== this.generation) {
          for (const track of stream.getTracks()) track.stop();
          return false;
        }
        this.stream = stream;
        for (const track of stream.getVideoTracks()) {
          const ended = () => {
            if (generation !== this.generation) return;
            this.stop();
            this.onError("Camera đã ngắt kết nối. Bạn có thể mở lại hoặc tải ảnh lên.");
          };
          track.addEventListener("ended", ended);
          this.endedListeners.push([track, ended]);
        }
        this.video.srcObject = stream;
        this.emit("opening"); // make video visible before play(), including mobile Safari.
        await this.video.play();
        if (generation !== this.generation) return false;
        this.emit("live");
        return true;
      } catch (error) {
        if (generation !== this.generation) return false;
        this.stop();
        this.onError(this.errorMessage(error));
        return false;
      }
    }

    get ready() {
      return this.state === "live" && this.stream?.getVideoTracks().some(t => t.readyState === "live") &&
        this.video.readyState >= 2 && this.video.videoWidth > 0 && this.video.videoHeight > 0;
    }

    async capture() {
      if (!this.ready) {
        this.onError("Camera chưa có khung hình sẵn sàng. Hãy chờ một chút rồi chụp lại.");
        return null;
      }
      const generation = this.generation;
      this.emit("capturing");
      try {
        const canvas = this.createCanvas();
        // Bound memory/pixels to the existing upload API limit, without upscaling.
        const scale = Math.min(1, Math.sqrt(25_000_000 / (this.video.videoWidth * this.video.videoHeight)));
        canvas.width = Math.max(1, Math.floor(this.video.videoWidth * scale));
        canvas.height = Math.max(1, Math.floor(this.video.videoHeight * scale));
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Canvas unavailable");
        context.drawImage(this.video, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise((resolve, reject) => {
          canvas.toBlob(value => value ? resolve(value) : reject(new Error("Empty frame")), "image/jpeg", .92);
        });
        if (generation !== this.generation) return null;
        this.stop(); // The selected still image is sufficient; do not keep the lens active.
        return blob;
      } catch (_error) {
        if (generation !== this.generation) return null;
        this.emit("live");
        this.onError("Không chụp được ảnh từ camera. Hãy thử lại hoặc chọn ảnh từ thiết bị.");
        return null;
      }
    }
  }
  root.SmartKitchenCamera = SmartKitchenCamera;
  if (typeof module !== "undefined" && module.exports) module.exports = SmartKitchenCamera;
})(globalThis);
