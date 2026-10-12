import { ArrowUpRight, CandlestickChart, Check, ClipboardList } from "lucide-react";

/** A diagram of the workspace, deliberately without prices or market data. */
export function WorkspacePreview() {
  return (
    <figure className="workspace-preview" aria-label="交易工作台介面示意，非行情資料">
      <figcaption className="workspace-preview-heading">
        <span>
          <CandlestickChart size={17} aria-hidden /> 交易工作台
        </span>
        <span className="workspace-preview-tag">介面示意</span>
      </figcaption>
      <div className="workspace-preview-body" aria-hidden="true">
        <div className="workspace-preview-watch">
          <p>自選行情</p>
          {["觀察標的", "價格變化", "成交紀錄"].map((label, index) => (
            <div key={label} data-selected={index === 0}>
              <span>{label}</span>
              <i />
              <i />
            </div>
          ))}
        </div>
        <div className="workspace-preview-chart">
          <div>
            <span>歷史 K 線</span>
            <span>1 分鐘</span>
          </div>
          <svg viewBox="0 0 320 156" fill="none">
            <path
              d="M0 35H320M0 75H320M0 115H320M40 0V156M100 0V156M160 0V156M220 0V156M280 0V156"
              stroke="currentColor"
              opacity=".12"
            />
            <path
              d="M8 119L38 104L68 111L98 84L128 92L158 58L188 72L218 40L248 49L278 24L310 36"
              stroke="#85b9ff"
              strokeWidth="2"
              strokeDasharray="4 5"
              opacity=".55"
            />
            {[
              [28, 92, 122, true],
              [56, 100, 117, false],
              [84, 76, 108, true],
              [112, 83, 99, false],
              [140, 58, 88, true],
              [168, 63, 82, false],
              [196, 38, 69, true],
              [224, 45, 63, false],
              [252, 22, 54, true],
              [280, 30, 47, false],
            ].map(([x, top, bottom, up], index) => (
              <g key={index} stroke={up ? "#ff7887" : "#56cdb3"}>
                <path d={`M${x} ${Number(top) - 9}V${Number(bottom) + 9}`} />
                <rect
                  x={Number(x) - 6}
                  y={Number(top)}
                  width="12"
                  height={Number(bottom) - Number(top)}
                  fill={up ? "#ff7887" : "#56cdb3"}
                  fillOpacity=".75"
                />
              </g>
            ))}
          </svg>
          <p>逐分鐘觀察 · 自己決定進退</p>
        </div>
      </div>
      <div className="workspace-preview-footer">
        <span>
          <ClipboardList size={15} aria-hidden /> 寫下計畫
        </span>
        <ArrowUpRight size={15} aria-hidden />
        <span>
          <Check size={15} aria-hidden /> 保存復盤
        </span>
      </div>
    </figure>
  );
}
