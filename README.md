# AudioSteg
Audio Steganography PWA

A full PWA steganography app that hides messages in audio files using **LSB (Least Significant Bit)** encoding. It decodes your MP3 into raw PCM, embeds data bit-by-bit into the last bit of each sample (inaudible), and exports a lossless WAV. The output is WAV because re-encoding to MP3 is lossy and would destroy the hidden bits.

Here's **AudioSteg** — a fully functional steganography app with a classified-intelligence terminal aesthetic.

**How it works technically:**

- **Encode:** Drops your MP3/WAV into the Web Audio API's `decodeAudioData()`, converts channel 0 to Int16 PCM, writes a 32-bit length header followed by your message bits into the LSB of each sample, then exports as a lossless WAV. Changing a 16-bit sample's LSB shifts amplitude by **<0.003%** — completely inaudible.
- **Decode:** Reads LSBs from channel 0, reconstructs the length header, then the payload bytes.

**Key limitations to know:**

- Output is **WAV, not MP3** — MP3 re-encoding is lossy and would destroy the hidden bits
- The WAV file will be larger than the original MP3 (uncompressed PCM)
- This is **not encrypted** — anyone with this tool can extract the message if they know it's there. For real security, encrypt your message first before embedding it.

**As a full PWA,** you'd deploy this with a `manifest.json` and a service worker for offline support — the core logic is all here and runs 100% client-side with zero network transmission.
