

document.addEventListener("DOMContentLoaded", function () {
    // Variable to store the user count for testing
    let userCount = parseInt(localStorage.getItem('userCount') || '0');

    // Display the user count on the page
    document.getElementById("userCountDisplay").innerText = `Unique Device Visits: ${userCount}`;

    // Check if the device has visited before
    if (localStorage.getItem('deviceVisited') === null) {
        // If not, mark this device as visited and increment the user count
        localStorage.setItem('deviceVisited', 'true');
        userCount++;
        localStorage.setItem('userCount', userCount.toString());
    }

    // Handle form submission
    document.getElementById("contactForm").addEventListener("submit", async function (event) {
        event.preventDefault(); // Prevent default form submission

        // Get form values
        const username = document.getElementById("username").value;
        const subject = document.getElementById("subject").value;
        const message = document.getElementById("message").value;
        const sendButton = document.getElementById("sendButton"); // Button element               
        
        const apiUrl = "https://back-endportfolio-production.up.railway.app/api/v1/message/send";
        const requestBody = { username, subject, message };

        try { 
            // Disable the button to prevent multiple clicks
            sendButton.disabled = true;
            sendButton.innerText = "Sending...";

            const response = await fetch(apiUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(requestBody)
            });

            console.log("Body Req:", requestBody);

            if (response.status === 201) { // ✅ Corrected status check
                document.getElementById("responseMessage").innerHTML =
                    `<div class="alert alert-success">Message sent successfully!</div>`;
                document.getElementById("contactForm").reset(); // Reset form
            } else {
                document.getElementById("responseMessage").innerHTML =
                    `<div class="alert alert-danger">Error: Something went wrong</div>`;
            }
        } catch (error) {
            document.getElementById("responseMessage").innerHTML =
                `<div class="alert alert-danger">Error: ${error.message}</div>`;
        } finally {
            // Re-enable the button after request is complete
            sendButton.disabled = false;
            sendButton.innerText = "Send Message";
        }
    });

    // You can test the count variable in the console for now:
    console.log('Current user count:', userCount);
});

