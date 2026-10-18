import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '2mb' }));

  // Server-side Horoscope Multi-Source Synthesis & Timezone Normalization Endpoint
  app.post('/api/horoscope/synthesize', async (req, res) => {
    try {
      const {
        profile,
        sources,
        targetDate,
        customExcerpt,
      } = req.body;

      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
        res.status(503).json({
          error: 'Server Gemini API key not configured; using deterministic local astrological synthesis engine.',
          fallback: true,
        });
        return;
      }

      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

      const primarySign = profile?.hasExactTime && profile?.risingSign
        ? `${profile.risingSign} Rising (Ascendant - Primary Chart Ruler, Sun in ${profile.sunSign}, Moon in ${profile.moonSign})`
        : `${profile?.sunSign || 'Aries'} Sun (Solar Chart Mode - Birth Time Unknown, Moon in ${profile?.moonSign || 'Taurus'})`;

      const sourceDescriptions = (sources || [])
        .map((s: any) => `- [${s.name} | Type: ${s.type} | Native TZ: ${s.sourceTimezone} | Weight: ${s.weight}x]: "${s.sampleExtract}"`)
        .join('\n');

      const prompt = `
You are an expert astrological synthesis engine.
Analyze the following multi-source horoscope extracts and astrological transits for the user:
- User Primary Sign Configuration: ${primarySign}
- Birth Timezone: ${profile?.birthTimezone || 'UTC'}
- User Operating Timezone: ${profile?.operatingTimezone || 'UTC'}
- Target Date: ${targetDate || new Date().toISOString().split('T')[0]}
- Active Priority Categories: ${(profile?.activeCategories || []).join(', ')}

Active Crawled Horoscope Sources (with their native publication timezones):
${sourceDescriptions}
${customExcerpt ? `\nAdditional Live Crawled Extract:\n"${customExcerpt}"` : ''}

Instructions:
1. Normalize all planetary transit timings mentioned across the sources from their native publication timezones into UTC first, then project them into the user's Operating Timezone (${profile?.operatingTimezone || 'UTC'}).
2. Prioritize house placements and transit impacts by the user's Rising sign if available; otherwise use their Sun sign.
3. Generate a synthesized daily astrological executive summary, key planetary transit highlights with UTC and local times, and 5 specific, actionable daily activities across the user's categories (including at least one Financial Caution window and optimal project/social/hobby/wellness slots).
`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              executiveSummary: {
                type: Type.STRING,
                description: 'Synthesized 2-3 sentence daily forecast correlating the active sources with the user sign.',
              },
              dominantTransit: {
                type: Type.STRING,
                description: 'Primary planetary aspect or house ingress driving today (e.g., Mercury trine Natal Ascendant in 10th House).',
              },
              consensusScore: {
                type: Type.INTEGER,
                description: 'Cross-source agreement percentage between 72 and 98.',
              },
              timezoneAdjustmentNote: {
                type: Type.STRING,
                description: 'Explanation of how source timestamps were normalized to UTC and shifted to the user operating timezone.',
              },
              activities: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    category: {
                      type: Type.STRING,
                      description: 'One of: career, social, hobbies, finance, wellness, mind, strategic, rest',
                    },
                    title: {
                      type: Type.STRING,
                    },
                    description: {
                      type: Type.STRING,
                    },
                    utcWindow: {
                      type: Type.STRING,
                      description: 'Normalized UTC window in HH:MM - HH:MM UTC format',
                    },
                    localWindow: {
                      type: Type.STRING,
                      description: 'Projected time window in user operating timezone (HH:MM - HH:MM)',
                    },
                    significance: {
                      type: Type.STRING,
                      description: 'One of: favorable, caution, neutral',
                    },
                    cosmicReason: {
                      type: Type.STRING,
                      description: 'Astrological transit and house reason (referencing Rising or Sun sign)',
                    },
                    sourceAttribution: {
                      type: Type.STRING,
                      description: 'Which active source(s) informed this time slot',
                    },
                    energyDimension: {
                      type: Type.STRING,
                      description: 'One of: mental, physical, emotional, creative, social, financialRisk',
                    },
                  },
                  required: [
                    'category',
                    'title',
                    'description',
                    'utcWindow',
                    'localWindow',
                    'significance',
                    'cosmicReason',
                    'sourceAttribution',
                    'energyDimension',
                  ],
                },
              },
            },
            required: [
              'executiveSummary',
              'dominantTransit',
              'consensusScore',
              'timezoneAdjustmentNote',
              'activities',
            ],
          },
        },
      });

      const text = response.text || '{}';
      const parsed = JSON.parse(text);
      res.json(parsed);
    } catch (error: any) {
      console.error('Gemini synthesis error:', error?.message || error);
      res.status(500).json({
        error: error?.message || 'Failed to synthesize horoscope sources',
        fallback: true,
      });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        watch: null,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`CelestialPulse server listening on http://localhost:${PORT}`);
  });
}

startServer();
