import { useState, useMemo } from 'react';
import { subHours, subDays, startOfDay } from 'date-fns';

const presets = [
  { label: '24h', getValue: () => ({ startDate: subHours(new Date(), 24).toISOString(), endDate: new Date().toISOString() }) },
  { label: '7d', getValue: () => ({ startDate: subDays(startOfDay(new Date()), 6).toISOString(), endDate: new Date().toISOString() }) },
  { label: '30d', getValue: () => ({ startDate: subDays(startOfDay(new Date()), 29).toISOString(), endDate: new Date().toISOString() }) },
  { label: '90d', getValue: () => ({ startDate: subDays(startOfDay(new Date()), 89).toISOString(), endDate: new Date().toISOString() }) },
];

export default function DateRangePicker({ value, onChange }) {
  const [activePreset, setActivePreset] = useState('7d');

  const handlePresetClick = (preset) => {
    setActivePreset(preset.label);
    onChange(preset.getValue());
  };

  return (
    <div className="date-range-picker">
      {presets.map((preset) => (
        <button
          key={preset.label}
          className={`date-range-btn ${activePreset === preset.label ? 'active' : ''}`}
          onClick={() => handlePresetClick(preset)}
        >
          {preset.label}
        </button>
      ))}
    </div>
  );
}
