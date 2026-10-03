# Third-party notices

SignBridge uses the following third-party software and assets, each under its own license. Verify versions and license texts in their sources before redistribution.

| Component | Use | License |
|---|---|---|
| MediaPipe Tasks Vision (`@mediapipe/tasks-vision`), loaded from jsDelivr | In-browser hand and pose landmark extraction | Apache-2.0 |
| MediaPipe Hand Landmarker and Pose Landmarker (lite) models, loaded from Google Cloud Storage | Landmark models | Apache-2.0 (see MediaPipe model cards) |
| Model Context Protocol TypeScript SDK (`@modelcontextprotocol/sdk`) | MCP server and client (Streamable HTTP) | MIT |
| Express | HTTP server | MIT |
| Zod | Tool input schemas | MIT |
| AWS SDK for JavaScript v3 (`@aws-sdk/client-s3`, `@aws-sdk/client-bedrock-runtime`), optional | S3 evidence storage, Bedrock intent parsing and agent | Apache-2.0 |
| Atkinson Hyperlegible font (Braille Institute), via Google Fonts | UI typography | SIL Open Font License 1.1 |

No third-party sign-language videos are included. Sign clips in `public/signs/` must be recorded by the project author or used with the signer's written permission.
