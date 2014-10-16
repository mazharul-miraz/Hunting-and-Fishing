// this is to transform the Fishes.json and gnis_places.json into
// individual fish species files.
// it runs under node.js
// it will not overwrite any existing files

var fs = require('fs');

var fishes = require('./Fishes.json');

var places = require('../gnis_places.json');

// loop through the species and write out each file
var species = fishes.forEach(function(f) {
	var filename = 'species/' + f.CommonName.toLowerCase().replace(/ +/, '_') + '.json';
	fs.exists(filename, function(exists) {
		if (exists) {
			console.log('skipping', f.CommonName);
			return;
		}
		// illegal to catch herring, skip this family
		if (f.Family == 7) {
			console.log('skipping herring family species', f.CommonName);
			return;
		}
		fs.writeFile(
			filename,
			'[\n' + JSON.stringify(
				{
					"_comment": "This file was generated by a script and has not been reviewed for accuracy. Please remove this comment after reviewing.",
					"state": "Virginia",
					"agency": "Department of Game and Inland Fisheries",
					"date_effective": "2013-07-01",
					"date_expires": "2014-06-30",
					"schema": "https://raw.githubusercontent.com/opendata/Hunting-and-Fishing/master/schemas/1.0a/fishing.json",
					"schema_version": "1.0a",
					"documentation": "",
					"species": {
						"name": f.CommonName,
						"taxonomy": f.ScientificName,
						"bova_id": parseInt(f.BOVA),
						"images": [	],
						"aliases": f.OtherNames.split(', '),
						"identification": getIdentificationString(f.Family, f.Identification)
					},
					"limits": {}, // TODO: placeholder, limits are not available in the data source yet
					"best_fishing": parseBestFishing(f.BestFishingNarrative),
					"fishing_techniques": f.Fishing
				}, null, "\t") + '\n]\n', 
			function(error) {
				if (error) { console.log('error', f.CommonName); console.log(error); }
				else { console.log('saved', f.CommonName); }
			}
		);
	});
});

// parse a 'BestFishingNarrative' string to extract place names.
// returns a 'best_fishing' object with lakes and rivers populated.
function parseBestFishing(str) {
	var str = str.replace(/\\n/,' ');
	var obj = {
		// this is a new field, to save the full best fishing text for convenience
		"description": str, 
		"lakes": {}, 
		"rivers": {} 
	};

	// this function parses either rivers or lakes depending on what is passed
	// supports alternate marker text because sometimes the rivers start with 
	// 'Rivers:' and sometimes 'Rivers and Streams:'
	var parseInternal = function(prop, marker, otherMarker, altMarker, altOtherMarker) {
		// this is the start index of the section we want
		var index1 = str.indexOf(marker);
		if (index1 == -1 && altMarker) {
			index1 = str.indexOf(altMarker);
			marker = altMarker;
		}
		// this is the start index of the other section, so we know where to stop
		var index2 = str.indexOf(otherMarker);
		if (index2 == -1 && altOtherMarker) {
			index2 = str.indexOf(altOtherMarker);
			otherMarker = altOtherMarker;
		}
		// TODO: comment field of place object
		if (index1 != -1) {
			// determine the end of our list
			var end = index2 > index1 ? index2 : str.length;
			// get the text minus the initial marker
			var list = str.substring(index1 + marker.length, end);
			// successively split until we have a single place name
			list.split(',').forEach(function(i) {
				i.split(/\band\b/).forEach(function(j) {
					j.split('/').forEach(function(k) {
						k.split(';').forEach(function(m) {
							var name = m.replace('.', '').trim();
							if (name && name.length > 1) {
								// populate the object with the GNIS lookup result
								obj[prop][name] = lookupGnis(name, prop);
							}
						});
					});
				});
			});
		}
	}

	// now we actually call the parsing function with different parameters
	parseInternal("lakes", "Lakes:", "Rivers:", null, "Rivers and Streams:");
	parseInternal("rivers", "Rivers:", "Lakes:", "Rivers and Streams:", null);

	return obj;
}

// get the identification string we need - if the family is known we prepend it
function getIdentificationString(family, identification) {	
	// from fish_families.json, easier to just hardcode it
	var families = {
		1: "Sunfish",
		2: "Striped Bass",
		3: "Perch",
		4: "Pike",
		5: "Trout",
		6: "Catfish"
	};

	var fam = families[family];
	if (fam == undefined) return identification;
	return fam + ' family. ' + identification;
}

var _lookupGnisCache = {};
// look up a place name in GNIS and return a place object
// optionally, do a contains, rather than exact, match
// also cache it if it's already been done
function lookupGnis(name, type, contains) {
	var cached;
	if (cached = _lookupGnisCache[type + "/" + name])
		return cached;

	// some cleanup
	name = name.replace(/(\bthe\b|\btidal\b|\bmainstem\b|\(.*|\))/,'').trim();
	// type is 'rivers' or 'lakes'
	// populate the basic object and then some matches to do
	var obj = { "gnis_id": null };
	var classes = [];
	var names = [];
	if (type == 'rivers') {
		classes = ['Stream'];
		names = [ name, name + ' River', name + ' Creek' ];
	} else if (type == 'lakes') {
		classes = ['Reservoir', 'Lake'];
		names = [ name, name + ' Lake', 'Lake ' + name, name + ' Reservoir', name + ' Lake (historical)' ];
	} else return obj;

	// do the filter and handle the results
	var matches = places.filter(function(p) {
		if (!contains) {
			return classes.indexOf(p.feature_class) != -1 &&
				names.indexOf(p.feature_name) != -1;
		} else {
			return classes.indexOf(p.feature_class) != -1 &&
				p.feature_name.indexOf(name) != -1;
		}
	});

	if (matches.length == 0) {
		// no exact matches, try contains match
		if (!contains) return lookupGnis(name, type, true);
		console.log('GNIS: No match for', name);
	} else if (matches.length == 1 || !contains) {
		// multiple exact match results considered equivalent
		obj.gnis_id = matches[0].feature_id;
		// new fields
		obj.latitude = matches[0].prim_lat_dec;
		obj.longitude = matches[0].prim_long_dec;
	} else {
		// do not add ambiguous places, this only happens on contains matches
		console.log('GNIS: Found', matches.length, 'matches for', name);
		matches.forEach(function (m) {
			console.log('*', m.feature_name, '/', m.prim_lat_dec, ',', m.prim_long_dec);
		});
	}

	_lookupGnisCache[type + "/" + name] = obj;
	return obj;
}
