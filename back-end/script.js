document.addEventListener("DOMContentLoaded", function () {
    // Variable to store the user count for testing
    let userCount = parseInt(localStorage.getItem('userCount') || '0');

    // Display the user count on the page
    const userCountDisplay = document.getElementById("userCountDisplay");
    if (userCountDisplay) {
        userCountDisplay.innerText = `Unique Device Visits: ${userCount}`;
    }

    // Check if the device has visited before
    if (localStorage.getItem('deviceVisited') === null) {
        localStorage.setItem('deviceVisited', 'true');
        userCount++;
        localStorage.setItem('userCount', userCount.toString());
    }

    // Handle form submission
    const contactForm = document.getElementById("contactForm");
    if (contactForm) {
        contactForm.addEventListener("submit", async function (event) {
            event.preventDefault(); // ✅ Prevent default form submission

            // Get form values
            const username = document.getElementById("username").value;
            const subject = document.getElementById("subject").value;
            const message = document.getElementById("message").value;
            const sendButton = document.getElementById("sendButton");
            const responseMessage = document.getElementById("responseMessage");

            const apiUrl = "https://back-endportfolio-production.up.railway.app/api/v1/message/send";
            const requestBody = { username, subject, message };

            try {
                sendButton.disabled = true;
                sendButton.innerText = "Sending...";

                const response = await fetch(apiUrl, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(requestBody)
                });

                console.log("Body Req:", requestBody);

                if (response.ok) { // ✅ Check if the response is successful
                    responseMessage.innerHTML = `<div class="alert alert-success">Message sent successfully!</div>`;
                    contactForm.reset();
                } else {
                    responseMessage.innerHTML = `<div class="alert alert-danger">Error: Something went wrong</div>`;
                }
            } catch (error) {
                responseMessage.innerHTML = `<div class="alert alert-danger">Error: ${error.message}</div>`;
            } finally {
                sendButton.disabled = false;
                sendButton.innerText = "Send Message";
            }

            return false; // ✅ Extra safeguard to prevent reloading
        });
    }

    console.log('Current user count:', userCount);
});
