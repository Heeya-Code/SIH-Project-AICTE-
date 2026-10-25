// Marks rows created while seeding/generating as synthetic demo data. Rows entered through the running application are not.
let synthetic = 0;
export const originFlag = () => synthetic;
export const setSynthetic = (on: boolean) => { synthetic = on ? 1 : 0; };
