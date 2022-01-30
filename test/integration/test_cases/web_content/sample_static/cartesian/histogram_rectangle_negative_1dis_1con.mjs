import { data } from '../../../../test_data/chart_types_eu.mjs';

const testSteps = [
  chart => chart.animate({
    data: data,
    config: {
      channels: {
        x: { set: ['Year'] },
        y: { set: ['Value 5 (+/-)'] },
        label: { set: ['Value 5 (+/-)'] }
      },
      title: 'Histogram',
      align: 'none'
    },
    /* Spaces between markers should be
    eliminated on this chart. */
    style: { 
      'plot.marker.rectangleSpacing': 0.07
    }
  })
];

export default testSteps;