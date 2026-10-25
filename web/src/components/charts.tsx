import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const COLORS = ['#1d5fa8', '#0f8b8d', '#b42318', '#c27b0e', '#5b6b7e'];
const axis = { fontSize: 12, fill: '#566579' };

export function NameValueChart({ data, type = 'bar', height = 240 }: { data: { name: string; value: number }[]; type?: 'bar' | 'line' | 'pie'; height?: number }) {
  if (!data?.length) return <p className="py-8 text-center text-muted">No data to chart yet.</p>;
  return (
    <div style={{ height }} role="img" aria-label={`Chart: ${data.map(d => `${d.name} ${d.value}`).join(', ')}`}>
      <ResponsiveContainer width="100%" height="100%">
        {type === 'line' ? (
          <LineChart data={data} margin={{ left: -16, right: 8, top: 8 }}><CartesianGrid stroke="#e6ebf1" vertical={false} /><XAxis dataKey="name" tick={axis} /><YAxis tick={axis} allowDecimals={false} /><Tooltip />
            <Line type="monotone" dataKey="value" stroke={COLORS[0]} strokeWidth={2} dot={{ r: 3 }} /></LineChart>
        ) : (
          <BarChart data={data} margin={{ left: -16, right: 8, top: 8 }}><CartesianGrid stroke="#e6ebf1" vertical={false} /><XAxis dataKey="name" tick={axis} interval={0} angle={data.length > 5 ? -20 : 0} textAnchor={data.length > 5 ? 'end' : 'middle'} height={data.length > 5 ? 56 : 30} /><YAxis tick={axis} allowDecimals={false} /><Tooltip cursor={{ fill: '#f1f5fa' }} />
            <Bar dataKey="value" fill={COLORS[0]} radius={[3, 3, 0, 0]} /></BarChart>
        )}
      </ResponsiveContainer>
    </div>);
}

export function SeriesChart({ type, rows, x, series, height = 280 }: { type: 'bar' | 'line'; rows: any[]; x: string; series: { key: string; label: string }[]; height?: number }) {
  if (!rows?.length) return null;
  const common = { data: rows, margin: { left: -12, right: 8, top: 8 } };
  return (
    <div style={{ height }} role="img" aria-label="Report chart">
      <ResponsiveContainer width="100%" height="100%">
        {type === 'line' ? (
          <LineChart {...common}><CartesianGrid stroke="#e6ebf1" vertical={false} /><XAxis dataKey={x} tick={axis} /><YAxis tick={axis} allowDecimals={false} /><Tooltip /><Legend />
            {series.map((s, i) => <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={COLORS[i]} strokeWidth={2} dot={{ r: 3 }} />)}</LineChart>
        ) : (
          <BarChart {...common}><CartesianGrid stroke="#e6ebf1" vertical={false} /><XAxis dataKey={x} tick={axis} interval={0} angle={rows.length > 5 ? -20 : 0} textAnchor={rows.length > 5 ? 'end' : 'middle'} height={rows.length > 5 ? 64 : 30} /><YAxis tick={axis} /><Tooltip cursor={{ fill: '#f1f5fa' }} /><Legend />
            {series.map((s, i) => <Bar key={s.key} dataKey={s.key} name={s.label} fill={COLORS[i]} radius={[3, 3, 0, 0]} />)}</BarChart>
        )}
      </ResponsiveContainer>
    </div>);
}

// Bar chart whose bars can be clicked to drill into the underlying cases.
export function DrillChart({ data, onPick, height = 230 }: { data: { key: string | number; label: string; value: number; drill?: any }[]; onPick?: (d: any) => void; height?: number }) {
  if (!data?.length) return <p className="py-8 text-center text-muted">No data for these filters.</p>;
  return (
    <div style={{ height }} role="img" aria-label={`Chart: ${data.map(d => `${d.label} ${d.value}`).join(', ')}`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ left: -16, right: 8, top: 8 }}><CartesianGrid stroke="#e6ebf1" vertical={false} /><XAxis dataKey="label" tick={axis} interval={0} angle={data.length > 4 ? -20 : 0} textAnchor={data.length > 4 ? 'end' : 'middle'} height={data.length > 4 ? 60 : 30} /><YAxis tick={axis} allowDecimals={false} /><Tooltip cursor={{ fill: '#f1f5fa' }} />
          <Bar dataKey="value" fill={COLORS[0]} radius={[3, 3, 0, 0]} cursor={onPick ? 'pointer' : undefined} onClick={(d: any) => onPick?.(d)} /></BarChart>
      </ResponsiveContainer>
    </div>);
}
