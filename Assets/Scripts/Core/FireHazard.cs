using UnityEngine;

namespace RunToExit.Core
{
    public class FireHazard : InteractableBase
    {
        // 炎は通行不可能な障害物
        public override bool IsObstacle(CharacterBase character) => true;

        public override void OnInteract(CharacterBase character)
        {
            // アイテムを使わずに触れようとした場合の処理（ダメージなど）
            Debug.Log($"{character.gameObject.name} touched fire and got hurt!");
        }

        public void Extinguish()
        {
            Debug.Log("Fire was extinguished!");
            // 消火演出などを入れてから消去
            Destroy(gameObject);
        }
    }
}
