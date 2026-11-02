import { it } from 'node:test';
import assert from 'node:assert/strict';
import { medicationStats, estimatedSupply } from '../continuity/medication.js';
import { medicationSnoozeSchema, medicationSupplySchema } from '../continuity/types.js';
const now=new Date('2026-10-29T08:00:00Z');
it('adherence excludes future doses, distinguishes silence and counts only reported taken',()=>{
  const report=(status:string,hour:number)=>({scheduledAt:new Date(`2026-10-29T0${hour}:00:00Z`),reportedAt:status==='unreported'?null:now,reportedStatus:status,snoozeCount:status==='unreported'?1:0});
  const stats=medicationStats([report('taken',5),report('missed',6),report('unreported',7),report('unreported',9)],now);
  assert.equal(stats.due,3);assert.equal(stats.taken,1);assert.equal(stats.skipped,1);assert.equal(stats.unconfirmed,1);assert.equal(stats.reported_taken_percent,33);assert.equal(stats.snoozed,1);
  assert.equal(medicationStats([],now).reported_taken_percent,null);
});
it('stock estimate uses explicit units, never infers dose quantities',()=>{
  assert.equal(estimatedSupply(20,null,5),20);assert.equal(estimatedSupply(20,2,5),10);assert.equal(estimatedSupply(2,2,5),0);assert.equal(estimatedSupply(1.5,.25,3),.75);
});
it('snooze only accepts bounded reminder delays and a version',()=>{
  for(const minutes of [5,10,15,30])assert.equal(medicationSnoozeSchema.parse({minutes,base_version:1}).minutes,minutes);
  for(const minutes of [-1,0,60,1440])assert.equal(medicationSnoozeSchema.safeParse({minutes,base_version:1}).success,false);
});
it('stock rejects negative, non-finite, missing units and excessive decimal precision',()=>{
  const good={base_version:0,quantity:20.125,unit_label:'tablets',low_stock_threshold:3};
  assert.equal(medicationSupplySchema.safeParse(good).success,true);
  for(const quantity of [-1,Infinity,NaN,.0001])assert.equal(medicationSupplySchema.safeParse({...good,quantity}).success,false);
  assert.equal(medicationSupplySchema.safeParse({...good,units_per_dose:0}).success,false);
  assert.equal(medicationSupplySchema.safeParse({...good,unit_label:''}).success,false);
});
