import QRCode from "qrcode";
import { formatNumber } from "@/lib/format";
import { CARTON_TYPE_LABEL, code128Svg, plainSvg, type CartonType } from "@/lib/supplier";

export type LabelCarton = { carton_type: CartonType; product: string; units: number; carton_no: number; barcode: string; label_svg?: string | null; weight_per_carton?: number | null };

// One label per page, 100 mm x 75 mm. The printer and label size at the supplier's warehouse are still to be
// confirmed: change the label size (.vr-label) and the page size (@page) here once they are known.
export const LABEL_CSS = `
.vr-label { width: 100mm; height: 75mm; box-sizing: border-box; padding: 3mm; display: flex; flex-direction: column; gap: 1.5mm; background: #fff; color: #000; font-family: Arial, Helvetica, sans-serif; overflow: hidden; break-inside: avoid; }
.vr-label-band { display: flex; align-items: center; justify-content: space-between; height: 13mm; padding: 0 3mm; font-weight: 800; }
.vr-label-band b { font-size: 11mm; line-height: 1; }
.vr-label-band span { font-size: 5mm; letter-spacing: 0.3mm; }
/* Hard: a solid black band. 2-ply: a white band with a thick dashed frame. They must not be confused at a glance. */
.vr-label-H .vr-label-band { background: #000; color: #fff; }
.vr-label-T .vr-label-band { background: #fff; color: #000; border: 1.2mm dashed #000; }
.vr-label-name { font-size: 4.6mm; font-weight: 700; line-height: 1.15; max-height: 11mm; overflow: hidden; }
.vr-label-meta { display: flex; justify-content: space-between; font-size: 3.6mm; }
.vr-label-codes { display: flex; align-items: flex-end; gap: 3mm; margin-top: auto; }
.vr-label-bars { flex: 1; min-width: 0; }
.vr-label-bars svg { display: block; width: 100%; height: 17mm; }
.vr-label-digits { font-family: "Courier New", monospace; font-size: 3.8mm; font-weight: 700; letter-spacing: 0.5mm; text-align: center; margin-top: 0.8mm; }
.vr-label-qr svg { display: block; width: 21mm; height: 21mm; }
.vr-label-sheet { display: flex; flex-wrap: wrap; gap: 12px; }
.vr-label-sheet .vr-label { border: 1px solid #999; }
@media print {
  @page { size: 100mm 75mm; margin: 0; }
  html, body { background: #fff !important; }
  .vr-label-sheet { display: block; }
  .vr-label-sheet .vr-label { border: 0; break-after: page; }
}
`;

/**
 * One carton label: the carton type band, product, units, dispatch and carton number, the inventory software's barcode
 * (what the warehouse scans) and the same number as a QR code (what a phone camera reads when loading).
 */
export async function Label({ carton, dispatchNo, due }: { carton: LabelCarton; dispatchNo: number; due: string }) {
  const qr = await QRCode.toString(carton.barcode, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  return (
    <div className={`vr-label vr-label-${carton.carton_type}`}>
      <div className="vr-label-band">
        <span>{CARTON_TYPE_LABEL[carton.carton_type].toUpperCase()} CARTON</span>
        <b>{carton.carton_type}</b>
      </div>
      <div className="vr-label-name">{carton.product}</div>
      <div className="vr-label-meta">
        <span>
          <b>{formatNumber(carton.units)}</b> pcs/carton
        </span>
        <span>
          Dispatch <b>{dispatchNo}</b> · Carton <b>{carton.carton_no}</b>
        </span>
      </div>
      <div className="vr-label-meta">
        <span>
          To: VRPRIME{carton.weight_per_carton ? (
            <>
              {" · "}
              <b>{carton.weight_per_carton} kg</b>
            </>
          ) : null}
        </span>
        <span>{due}</span>
      </div>
      <div className="vr-label-codes">
        <div className="vr-label-bars">
          {/* The barcode picture the inventory software made for this label; the portal only draws one if that is missing. */}
          <div dangerouslySetInnerHTML={{ __html: plainSvg(carton.label_svg) ?? code128Svg(carton.barcode) }} />
          <div className="vr-label-digits">{carton.barcode}</div>
        </div>
        <div className="vr-label-qr" dangerouslySetInnerHTML={{ __html: qr }} />
      </div>
    </div>
  );
}
