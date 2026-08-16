// Supabase Edge Function: classify-waste
// Proxies classification requests securely to Python FastAPI YOLO Inference Microservice
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { imageBase64, imageName } = await req.json();

    if (!imageBase64) {
      return new Response(
        JSON.stringify({ error: "Missing imageBase64 in request payload" }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Server-side YOLO inference microservice URL configured via environment secret
    const yoloServiceUrl = Deno.env.get('YOLO_INFERENCE_SERVICE_URL') || 'http://localhost:8000/classify';

    try {
      const response = await fetch(yoloServiceUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64, imageName })
      });

      if (response.ok) {
        const yoloResult = await response.json();
        
        return new Response(
          JSON.stringify(yoloResult),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    } catch (e) {
      console.warn("YOLO microservice connection error:", e);
    }

    // STRICT ZERO-FAKE POLICY: Do not generate fake classifications on infrastructure failure
    return new Response(
      JSON.stringify({
        success: false,
        is_waste: false,
        reason: "service_unavailable",
        message: "AI classification microservice is temporarily unavailable. Please try again.",
        category: "Non-Recyclable",
        confidence: 0,
        server_notice: "Inference Microservice Offline"
      }),
      { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message || 'Internal Edge Function Error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
