

const path = require("path");

module.exports = {
    mode: "production",
    entry: "./src/vendor-entry.js",
    output: {
        path:           path.resolve(__dirname, "vendor"),
        filename:       "velocityjs.bundle.js",
        library:        "Velocity",
        libraryTarget:  "window",
        libraryExport:  "default"
    },
    target: ["web", "es5"]
};
