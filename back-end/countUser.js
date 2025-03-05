// document.addEventListener("DOMContentLoaded", function () {
//     // Function to generate a unique device ID (can be a UUID or a random string)
//     function generateDeviceId() {
//         return 'device-' + Math.random().toString(36).substr(2, 9);
//     }

//     // Check if device ID is stored in localStorage
//     let deviceId = localStorage.getItem('deviceId');

//     // If device ID is not stored, generate a new one and store it
//     if (!deviceId) {
//         deviceId = generateDeviceId();
//         localStorage.setItem('deviceId', deviceId);
//     }

//     // Display the device ID
//     document.getElementById("userInfoDisplay").innerText = `Device ID: ${deviceId}`;
    
//     // Log the device ID in the console
//     console.log(`Device ID: ${deviceId}`);
// });


const activeUser = document.getElementById("activeUser");

function startMove(e) {
    e.preventDefault();
    let isTouch = e.type.includes("touch");
    let startX = isTouch ? e.touches[0].clientX : e.clientX;
    let startY = isTouch ? e.touches[0].clientY : e.clientY;
    let offsetX = startX - activeUser.getBoundingClientRect().left;
    let offsetY = startY - activeUser.getBoundingClientRect().top;

    function moveElement(e) {
      let clientX = isTouch ? e.touches[0].clientX : e.clientX;
      let clientY = isTouch ? e.touches[0].clientY : e.clientY;
      activeUser.style.left = clientX - offsetX + "px";
      activeUser.style.top = clientY - offsetY + "px";
    }

    function stopMoving() {
      document.removeEventListener("mousemove", moveElement);
      document.removeEventListener("mouseup", stopMoving);
      document.removeEventListener("touchmove", moveElement);
      document.removeEventListener("touchend", stopMoving);
    }

    document.addEventListener(isTouch ? "touchmove" : "mousemove", moveElement);
    document.addEventListener(isTouch ? "touchend" : "mouseup", stopMoving);
  }

  activeUser.addEventListener("mousedown", startMove);
  activeUser.addEventListener("touchstart", startMove);

  activeUser.addEventListener("dblclick", () => {
    activeUser.classList.toggle("hidden");
  });

   // Double-tap detection (for mobile)
  let lastTap = 0;
  activeUser.addEventListener("touchend", (e) => {
    let currentTime = new Date().getTime();
    let tapLength = currentTime - lastTap;
    if (tapLength < 300 && tapLength > 0) {
      activeUser.classList.toggle("hidden");
    }
    lastTap = currentTime;
  });


    // Click to show message box
    activeUser.addEventListener("click", () => {
        messageBox.classList.add("show");
        
        // Auto-hide after 3 seconds
        setTimeout(() => {
          messageBox.classList.remove("show");
        }, 3000);
      });

      // Click to show message box
      activeUser.addEventListener("touchend", () => {
        messageBox.classList.add("show");
        
        // Auto-hide after 3 seconds
        setTimeout(() => {
          messageBox.classList.remove("show");
        }, 3000);
      });