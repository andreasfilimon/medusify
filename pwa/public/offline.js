// Language of the offline page follows the device; the button reloads the app.
if (!(navigator.languages && navigator.languages[0] ? navigator.languages[0] : navigator.language || "").toLowerCase().startsWith("de")) {
  document.documentElement.lang = "en"
  document.getElementById("t").textContent = "No connection"
  document.getElementById("p").textContent = "Connect to the internet and try again."
  document.getElementById("b").textContent = "Try again"
}
document.getElementById("b").addEventListener("click", () => location.assign("/medusify/"))
