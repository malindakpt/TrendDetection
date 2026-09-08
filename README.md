# Early Trend Radar

**Live application:** [https://trend-detection.vercel.app/](https://trend-detection.vercel.app/)
 
## Getting Started

Install dependencies:

```bash
npm install
```
 
Process the supplied datasets and regenerate all output artifacts:

```bash
npm run process
```

Start the development dashboard at `http://localhost:3000`:

```bash
npm run dev
```

Build and run the production application:

```bash
npm run build
npm run start
```

`npm run test:watch` runs Vitest in watch mode.

 
## Limitations

- The system is an offline replay of the supplied dataset, not live platform ingestion.
- The detector's six-hour history and weighted thresholds are heuristics, not learned or calibrated models.
- Hashtag extraction is the implemented topic-discovery method; it does not perform semantic clustering.
- Potential data gaps are identified from unusually long post gaps, but are not confirmed collection outages.
- The in-memory, single-process implementation is intentionally scoped for an interview assignment rather than production-scale throughput.

## Future Work

The following are not implemented:

- Streaming ingestion and durable storage for live platform data.
- Distributed processing and operational monitoring/observability.
- Live platform API integrations and alert delivery channels.
- Model-based score calibration, topic grouping, and ranking evaluation against labeled outcomes.
