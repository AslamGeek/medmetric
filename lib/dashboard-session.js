import { dashboardModel, drilldownModel } from './analytics.js';

// One spreadsheet snapshot powers every view until the user refreshes it.
export function createDashboardSession(readSnapshot) {
  let snapshot=null, pending=null;
  return {
    restore(value) {
      if(value && Array.isArray(value.sales) && Array.isArray(value.monthly) && Array.isArray(value.config) && Array.isArray(value.months) && Array.isArray(value.agencies) && Array.isArray(value.warnings)) snapshot=value;
      return snapshot;
    },
    load(force=false) {
      if(pending)return pending;
      if(snapshot && !force)return Promise.resolve(snapshot);
      pending=Promise.resolve().then(()=>readSnapshot(force)).then(value=>{
        snapshot=value;
        return snapshot;
      }).finally(()=>{pending=null;});
      return pending;
    },
    dashboard(filters) { return dashboardModel(snapshot,filters); },
    drilldown(filters,request) { return drilldownModel(snapshot,filters,request); }
  };
}
