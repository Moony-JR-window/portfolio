document.addEventListener("DOMContentLoaded", function () {
    document.getElementById("contactForm").addEventListener("submit", async function (event) {
        event.preventDefault(); // Prevent default form submission

        // Get form values
        const username = document.getElementById("username").value;
        const subject = document.getElementById("subject").value;
        const message = document.getElementById("message").value;
        const sendButton = document.getElementById("sendButton"); // Button element
        let api= process.env.api;                                    
        const apiUrl = `${api}/api/v1/message/send`;

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
});
