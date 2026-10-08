export function Gauge({ value, max=100, color='#ff5064', size=120, stroke=9, children, className='' }) {
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const dash = circumference * Math.min(value / max, 1)

  return <div className={`gauge ${className}`} style={{'--gauge-color':color,width:size,height:size}}>
    <svg viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle className="gauge-track" cx={size/2} cy={size/2} r={radius} strokeWidth={stroke}/>
      <circle className="gauge-value" cx={size/2} cy={size/2} r={radius} strokeWidth={stroke} strokeDasharray={`${dash} ${circumference}`} transform={`rotate(-90 ${size/2} ${size/2})`}/>
    </svg>
    <div className="gauge-center">{children ?? <strong>{value}</strong>}</div>
  </div>
}

export function Card({ title, action, children, className='' }) {
  return <section className={`card ${className}`}><header className="card-header"><h2>{title}</h2>{action}</header>{children}</section>
}
