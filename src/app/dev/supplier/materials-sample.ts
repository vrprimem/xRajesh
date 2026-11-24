// The supplier's own materials (the list VRPRIME gave on 24 Nov 2026): the full name the supplier buys each by, and
// what the godown staff call it in English, Hindi and Marathi. For the development preview; the stock, packs and low
// levels the samples give them are made up.

export type SampleMaterial = { key: string; name: string; kind: "bottle" | "trigger" | "cap"; en: string; hi: string; mr: string };

export const MATERIALS: SampleMaterial[] = [
  { key: "b100", name: "19MM 100ML BOSTON WHITE BOTTLE", kind: "bottle", en: "100ml Bottle", hi: "100ml बोतल", mr: "100ml बाटली" },
  { key: "t100", name: "19MM MIST WHITE PUMP", kind: "trigger", en: "Trigger for 100ml Bottle", hi: "100ml बोतल का ट्रिगर", mr: "100ml बाटलीचा ट्रिगर" },
  { key: "c100", name: "19MM SIMPLE CAP", kind: "cap", en: "100ml Cap", hi: "100ml ढक्कन", mr: "100ml झाकण" },
  { key: "i100", name: "19MM INNER", kind: "cap", en: "100ml Inner", hi: "100ml इनर", mr: "100ml इनर" },
  // No simple name came with this one: "250ml Bottle", like the others.
  { key: "b250", name: "24MM 250ML BOSTON WHITE BOTTLE", kind: "bottle", en: "250ml Bottle", hi: "250ml बोतल", mr: "250ml बाटली" },
  { key: "mist", name: "24MM MIST WHITE PUMP", kind: "trigger", en: "Screen Mist Pump", hi: "स्क्रीन मिस्ट पंप", mr: "स्क्रीन मिस्ट पंप" },
  { key: "t250", name: "24MM MINI TRIGGER PUMP", kind: "trigger", en: "250ml Bottle Pump", hi: "250ml बोतल का पंप", mr: "250ml बाटलीचा पंप" },
  { key: "c250", name: "24MM SIMPLE CAP", kind: "cap", en: "250ml Bottle Cap", hi: "250ml बोतल का ढक्कन", mr: "250ml बाटलीचे झाकण" },
  { key: "i250", name: "24MM INNER", kind: "cap", en: "250ml Inner Cap", hi: "250ml इनर ढक्कन", mr: "250ml इनर झाकण" },
  { key: "b500", name: "28MM 400ML CYLINDER WHITE BOTTLE", kind: "bottle", en: "500ml Bottle", hi: "500ml बोतल", mr: "500ml बाटली" },
  { key: "c500", name: "28MM DUAL SEAL CAP", kind: "cap", en: "500ml Cap", hi: "500ml ढक्कन", mr: "500ml झाकण" },
  { key: "i500", name: "28MM INNER", kind: "cap", en: "500ml Inner", hi: "500ml इनर", mr: "500ml इनर" },
  { key: "t500", name: "28MM COLIN WHITE PUMP", kind: "trigger", en: "Trigger 500ml", hi: "500ml ट्रिगर", mr: "500ml ट्रिगर" },
  { key: "bshoe", name: "42MM 100ML FOAMING BOTTLE", kind: "bottle", en: "Shoe Bottle", hi: "शू बोतल", mr: "शू बाटली" },
  { key: "tshoe", name: "42MM FOAM PUMP", kind: "trigger", en: "Shoe Trigger", hi: "शू ट्रिगर", mr: "शू ट्रिगर" },
];

/** One of the materials, by key. */
export function material(key: string): SampleMaterial {
  const found = MATERIALS.find((m) => m.key === key);
  if (!found) throw new Error(`No sample material ${key}`);
  return found;
}
