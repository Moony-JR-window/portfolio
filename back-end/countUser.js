document.addEventListener("DOMContentLoaded", function () {
    // Function to generate a unique device ID (can be a UUID or a random string)
    function generateDeviceId() {
        return 'device-' + Math.random().toString(36).substr(2, 9);
    }

    // Check if device ID is stored in localStorage
    let deviceId = localStorage.getItem('deviceId');

    // If device ID is not stored, generate a new one and store it
    if (!deviceId) {
        deviceId = generateDeviceId();
        localStorage.setItem('deviceId', deviceId);
    }

    // Display the device ID
    document.getElementById("userInfoDisplay").innerText = `Device ID: ${deviceId}`;
    
    // Log the device ID in the console
    console.log(`Device ID: ${deviceId}`);
});
