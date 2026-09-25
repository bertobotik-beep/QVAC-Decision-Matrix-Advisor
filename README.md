# QVAC Decision-Matrix-Advisor

Score your options against your criteria and get an AI-backed recommendation.

## Run

```
npm install
npm start
```

Then open http://localhost:29534

## QVAC SDK

Built on `@qvac/sdk` ^0.19.0.

## How it works

All inference runs on-device via the QVAC SDK — the model is loaded once at startup with `loadModel`, each request streams a response through `completion`, and the model is released with `unloadModel` on shutdown. No text ever leaves this machine and no API key is required.

## License

MIT
