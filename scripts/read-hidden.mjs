/**
 * Reads a line from a terminal without showing what's typed.
 * Pressing Ctrl+C rejects, so the caller can stop cleanly.
 */
export function readHidden(input, output, prompt) {
  return new Promise((resolve, reject) => {
    let value = "";
    const wasRaw = input.isRaw;

    function finish() {
      input.setRawMode(wasRaw ?? false);
      input.removeListener("data", onData);
      input.pause();
      output.write("\n");
    }

    function onData(chunk) {
      for (const character of chunk.toString("utf8")) {
        if (character === "\u0003") {
          finish();
          reject(new Error("Cancelled"));
          return;
        }
        if (character === "\r" || character === "\n") {
          finish();
          resolve(value);
          return;
        }
        if (character === "\u007f" || character === "\b") {
          value = [...value].slice(0, -1).join("");
        } else if (character >= " ") {
          value += character;
        }
      }
    }

    output.write(prompt);
    input.setRawMode(true);
    input.resume();
    input.on("data", onData);
  });
}
