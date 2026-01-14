//https://code.earthengine.google.com/f033789c0f9ef0f4f2160f3b95908c1e


// Load the FAO GAUL administrative boundaries dataset
var countries = ee.FeatureCollection("FAO/GAUL/2015/level1");

// Filter to get only the Punjab and Haryana regions in India
var punjab = countries.filter(ee.Filter.and(
                ee.Filter.eq('ADM1_NAME', 'Punjab'),
                ee.Filter.eq('ADM0_NAME', 'India')
             ));
var haryana = countries.filter(ee.Filter.and(
                ee.Filter.eq('ADM1_NAME', 'Haryana'),
                ee.Filter.eq('ADM0_NAME', 'India')
             ));

// Combine Punjab and Haryana into one region of interest
var punjabHaryana = punjab.merge(haryana);

// Define the region geometry for Punjab and Haryana
var region = punjabHaryana.geometry();

// Define parameters
var startYear = 2018;
var endYear = 2023;
var startMonth = 6; // June, start of rice growing season
var endMonth = 10;  // October, end of rice growing season

// Load Landsat 8 Collection 2 and filter dates and location
var collection = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2')
                    .filterBounds(region)
                    .filter(ee.Filter.calendarRange(startYear, endYear, 'year'))
                    .filter(ee.Filter.calendarRange(startMonth, endMonth, 'month'));

// Cloud masking function
function maskClouds(image) {
  var qa = image.select('QA_PIXEL');
  var cloudMask = qa.bitwiseAnd(1 << 3).eq(0).and(qa.bitwiseAnd(1 << 4).eq(0)); // Cloud and shadow mask
  return image.updateMask(cloudMask);
}

// Apply cloud masking and calculate NDVI
var ndviCollection = collection.map(maskClouds).map(function(image) {
  var ndvi = image.normalizedDifference(['SR_B5', 'SR_B4']).rename('NDVI'); // SR_B5 (NIR), SR_B4 (Red) for Landsat 8
  return image.addBands(ndvi);
});

// Calculate annual mean NDVI for each year
var annualNDVI = ee.ImageCollection.fromImages(
  ee.List.sequence(startYear, endYear).map(function(year) {
    var yearlyCollection = ndviCollection
                             .filter(ee.Filter.calendarRange(year, year, 'year'))
                             .select('NDVI');
    return yearlyCollection.mean().set('year', year).rename('NDVI')
                                   .set('system:time_start', ee.Date.fromYMD(year, 6, 1).millis());
  })
);

var baseYearImage = annualNDVI.filter(ee.Filter.eq('year', startYear)).first();

// Define a base dark layer for the rest of India
var india = countries.filter(ee.Filter.eq('ADM0_NAME', 'India')).geometry();
var pakistan = countries.filter(ee.Filter.eq('ADM0_NAME', 'Pakistan')).geometry();
var nepal = countries.filter(ee.Filter.eq('ADM0_NAME', 'Nepal')).geometry();
var china = countries.filter(ee.Filter.eq('ADM0_NAME', 'China')).geometry();

var combinedGeometry = india.union(pakistan).union(nepal).union(china);

var darkLayer = ee.Image.constant(0.3).clip(combinedGeometry).visualize({palette: ['black']});
Map.addLayer(darkLayer, {}, 'Darkened India Base');

// Loop through each year from 2018 to 2023, calculate and display NDVI differences for Punjab and Haryana
for (var year = startYear + 1; year <= endYear; year++) {
  var currentImage = annualNDVI.filter(ee.Filter.eq('year', year)).first();
  
  // Calculate NDVI difference from 2018
  var diffImage = currentImage.subtract(baseYearImage).rename('NDVI_Diff');
  
  // Add the difference image layer to the map for Punjab and Haryana
  Map.addLayer(diffImage.clip(region), 
               {min: -0.3, max: 0.3, palette: ['yellow', 'grey', 'red']}, 
               'NDVI Difference 2018 to ' + year);
}

// Center map on region and display
Map.centerObject(region, 7);

// Visualize the time series as a chart
var ndviChart = ui.Chart.image.seriesByRegion({
  imageCollection: annualNDVI, 
  regions: region, 
  reducer: ee.Reducer.mean(), 
  band: 'NDVI', 
  scale: 500,
  xProperty: 'system:time_start'
}).setOptions({
  title: 'NDVI Time Series for Rice Crop (2018-2024) in Punjab and Haryana',
  hAxis: {title: 'Year'},
  vAxis: {title: 'Mean NDVI'},
  lineWidth: 2,
  colors: ['#1d6b99']
});
print(ndviChart);

// Export annual NDVI data for each year by mapping over annualNDVI
var annualExport = annualNDVI.map(function(image) {
  return image.reduceRegions({
    collection: ee.FeatureCollection(region),  // Specify the region as the feature collection
    reducer: ee.Reducer.mean(),
    scale: 500,
    crs: 'EPSG:4326'
  }).map(function(f) {
    return f.set('year', image.get('year'));  // Add year property to each feature
  });
}).flatten();  // Flatten to make a single FeatureCollection

// Export the NDVI time series data to Google Drive as CSV
Export.table.toDrive({
  collection: annualExport,
  description: 'Rice_NDVI_TimeSeries_2018_2024',
  fileFormat: 'CSV'
});




