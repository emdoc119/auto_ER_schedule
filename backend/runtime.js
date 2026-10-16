'use strict';
const {createStore}=require('./state');
const {createSyncService}=require('./sync-service');
const {createCalendarAdapter}=require('./calendar-writer');
function createRuntime(){
  if(!process.env.AER_STATE_DIR)throw Error('AER_STATE_DIR private path required');
  if(!process.env.AER_CALENDAR_ID || process.env.AER_CALENDAR_ID==='primary')throw Error('Explicit AER duty calendar required');
  const writesEnabled=process.env.AER_ENABLE_WRITES==='1';
  if(writesEnabled && !process.env.AER_OAUTH_WRITE_TOKEN_FILE)throw Error('Separate write token file required');
  const service=createSyncService({calendar:createCalendarAdapter(),store:createStore(process.env.AER_STATE_DIR),writesEnabled});
  return {service,writesEnabled};
}
module.exports={createRuntime};
