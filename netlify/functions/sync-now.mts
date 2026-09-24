import { syncScores } from './lib/sync';

// On-demand sync (admin "Sync scores now" button). Only writes ESPN data, so it's safe to expose.
export default async () => {
  try {
    const res = await syncScores({ full: true });
    return Response.json(res);
  } catch (e: any) {
    return Response.json({ error: e.message ?? String(e) }, { status: 500 });
  }
};
