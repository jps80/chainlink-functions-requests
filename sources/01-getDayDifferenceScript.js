// In this example we will return number of days till the next public holiday.

// We can define helper functions within our sandbox. 
// In this example helper can be used to calculate the difference between two dates.
function getDayDifference(startDate, endDate) {
    const oneDay = 24 * 60 * 60 * 1000; // Number of milliseconds in a day
  
    const start = new Date(startDate);
    const end = new Date(endDate);
  
    // Calculate the difference in days
    const diffInDays = Math.round(Math.abs((end.getTime() - start.getTime()) / oneDay));
  
    return diffInDays;
}

// Now when we have the helper we can actually start writing our function, to get the next public holiday.
let countryCode = args[0];

if (!countryCode) {
    console.log('No country code provided, defaulting to US');
    countryCode = 'US';
}

const apiResponse = await Functions.makeHttpRequest({
    url: `https://date.nager.at/Api/v2/NextPublicHolidays/${countryCode}`
})

if (apiResponse.error) {
    console.log('Make sure you have provided one of the supported country code values: \n')
    console.log(`Andorra (AD)
Albania (AL)
Argentina (AR)
Austria (AT)
Australia (AU)
Åland Islands (AX)
Bosnia and Herzegovina (BA)
Barbados (BB)
Belgium (BE)
Bulgaria (BG)
Benin (BJ)
Bolivia (BO)
Brazil (BR)
Bahamas (BS)
Botswana (BW)
Belarus (BY)
Belize (BZ)
Canada (CA)
Switzerland (CH)
Chile (CL)
China (CN)
Colombia (CO)
Costa Rica (CR)
Cuba (CU)
Cyprus (CY)
Czechia (CZ)
Germany (DE)
Denmark (DK)
Dominican Republic (DO)
Ecuador (EC)
Estonia (EE)
Egypt (EG)
Spain (ES)
Finland (FI)
Faroe Islands (FO)
France (FR)
Gabon (GA)
United Kingdom (GB)
Grenada (GD)
Guernsey (GG)
Gibraltar (GI)
Greenland (GL)
Gambia (GM)
Greece (GR)
Guatemala (GT)
Guyana (GY)
Honduras (HN)
Croatia (HR)
Haiti (HT)
Hungary (HU)
Indonesia (ID)
Ireland (IE)
Isle of Man (IM)
Iceland (IS)
Italy (IT)
Jersey (JE)
Jamaica (JM)
Japan (JP)
South Korea (KR)
Liechtenstein (LI)
Lesotho (LS)
Lithuania (LT)
Luxembourg (LU)
Latvia (LV)
Morocco (MA)
Monaco (MC)
Moldova (MD)
Montenegro (ME)
Madagascar (MG)
North Macedonia (MK)
Mongolia (MN)
Montserrat (MS)
Malta (MT)
Mexico (MX)
Mozambique (MZ)
Namibia (NA)
Niger (NE)
Nigeria (NG)
Nicaragua (NI)
Netherlands (NL)
Norway (NO)
New Zealand (NZ)
Panama (PA)
Peru (PE)
Papua New Guinea (PG)
Poland (PL)
Puerto Rico (PR)
Portugal (PT)
Paraguay (PY)
Romania (RO)
Serbia (RS)
Russia (RU)
Sweden (SE)
Singapore (SG)
Slovenia (SI)
Svalbard and Jan Mayen (SJ)
Slovakia (SK)
San Marino (SM)
Suriname (SR)
El Salvador (SV)
Tunisia (TN)
Turkey (TR)
Ukraine (UA)
United States (US)
Uruguay (UY)
Vatican City (VA)
Venezuela (VE)
Vietnam (VN)
South Africa (ZA)
Zimbabwe (ZW)`)
    throw new Error('Request failed');
}

const holiday = apiResponse.data[0];
if(!holiday) {
    console.log('No more holidays this year :(');
}

const today = new Date();
const holidayDate = new Date(holiday.date);
const daysTillHoliday = getDayDifference(today, holidayDate);
console.log(`Days till next holiday: ${daysTillHoliday}`);

return Functions.encodeUint256(daysTillHoliday);
