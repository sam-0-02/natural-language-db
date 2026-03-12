import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

const DynamicChart = ({ data }) => {
  // 1. Safety check: If there's no data, don't try to draw a chart
  if (!data || data.length === 0) return null;

  // 2. Analyze the first row of data to figure out the axes
  const sampleRow = data[0];
  const keys = Object.keys(sampleRow);
  
  let xAxisKey = null;
  let yAxisKey = null;

  // 3. Automatically find the best columns for X (text) and Y (numbers)
  keys.forEach(key => {
    if (typeof sampleRow[key] === 'string' && !xAxisKey) {
      xAxisKey = key; // First text column becomes the X-axis (e.g., 'department' or 'name')
    } else if (typeof sampleRow[key] === 'number' && !yAxisKey && key !== 'id') {
      yAxisKey = key; // First number column becomes the Y-axis (ignoring IDs)
    }
  });

  // 4. Fallback: If we couldn't find perfect matches, just use the first two columns
  if (!xAxisKey) xAxisKey = keys[0];
  if (!yAxisKey) yAxisKey = keys[1] || keys[0];

  return (
    <div style={{ width: '100%', height: 300, marginTop: '20px' }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey={xAxisKey} />
          <YAxis />
          <Tooltip />
          <Legend />
          <Bar dataKey={yAxisKey} fill="#8884d8" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};

export default DynamicChart;